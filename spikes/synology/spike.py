#!/usr/bin/env python3
"""Synology protocol spike. No daemon, mount, index, or queued writes."""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import secrets
import ssl
import time
from urllib.parse import quote, urlencode, urlsplit
import xml.etree.ElementTree as ET

MAX_RESPONSE = 4 * 1024 * 1024


class ProtocolError(Exception):
    pass


class Transport:
    def __init__(self, url, ca_file=None, certificate_sha256=None):
        self.url = urlsplit(url)
        if self.url.scheme not in ('https', 'http') or not self.url.hostname:
            raise ValueError('An HTTP(S) endpoint is required.')
        if self.url.username or self.url.password or self.url.query or self.url.fragment:
            raise ValueError('Keep credentials and query parameters out of endpoint URLs.')
        if self.url.scheme != 'https' and self.url.hostname not in ('localhost', '127.0.0.1', '::1'):
            raise ValueError('Use HTTPS for a remote NAS.')
        if certificate_sha256 and (len(certificate_sha256) != 64 or any(c not in '0123456789abcdef' for c in certificate_sha256.lower())):
            raise ValueError('Certificate pin must be a SHA-256 hex fingerprint verified out of band.')
        self.pin = certificate_sha256.lower() if certificate_sha256 else None
        self.context = ssl.create_default_context(cafile=ca_file)
        if self.pin:
            # Trust is the exact certificate, checked BEFORE any HTTP headers/body are sent.
            self.context.check_hostname = False
            self.context.verify_mode = ssl.CERT_NONE
        self.connection = None
        self.measurements = []

    def close(self):
        if self.connection:
            self.connection.close()
        self.connection = None

    def request(self, label, method, path, body=None, headers=None):
        start = time.monotonic()
        try:
            if self.connection is None or self.connection.sock is None:
                cls = http.client.HTTPSConnection if self.url.scheme == 'https' else http.client.HTTPConnection
                kwargs = {'timeout': 10}
                if self.url.scheme == 'https':
                    kwargs['context'] = self.context
                self.connection = cls(self.url.hostname, self.url.port, **kwargs)
                self.connection.connect()
                if self.pin:
                    actual = hashlib.sha256(self.connection.sock.getpeercert(binary_form=True)).hexdigest()
                    if actual != self.pin:
                        self.close()
                        raise ProtocolError('NAS certificate does not match the configured trusted fingerprint.')
            self.connection.request(method, path, body=body, headers=headers or {})
            response = self.connection.getresponse()
            data = response.read(MAX_RESPONSE + 1)
            if len(data) > MAX_RESPONSE:
                raise ProtocolError('Response exceeds the spike limit of 4 MiB.')
            result = (response.status, {k.lower(): v for k, v in response.getheaders()}, data)
            self.measurements.append({'operation': label, 'status': response.status, 'ms': round((time.monotonic() - start) * 1000, 2), 'bytes': len(data)})
            return result
        except (OSError, http.client.HTTPException):
            self.close()
            raise ProtocolError('Connection failed. A write may have reached the NAS; inspect the test file before retrying.') from None


def require_status(status, expected):
    if status not in expected:
        raise ProtocolError(f'Unexpected HTTP status {status}.')


class WebDAV:
    def __init__(self, transport, username, password, root):
        import base64
        self.transport = transport
        self.root = '/' + root.strip('/')
        self.authorization = 'Basic ' + base64.b64encode(f'{username}:{password}'.encode()).decode()

    def request(self, label, method, path, body=None, headers=None):
        return self.transport.request(label, method, quote(path, safe='/'), body, {'Authorization': self.authorization, **(headers or {})})

    def list(self):
        body = b'<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getetag/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>'
        status, _, data = self.request('list', 'PROPFIND', self.root + '/', body, {'Depth': '1', 'Content-Type': 'application/xml'})
        require_status(status, (207,))
        if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
            raise ProtocolError('XML entity declarations are not accepted.')
        tree = ET.fromstring(data)
        entries = []
        for entry in tree.findall('{DAV:}response'):
            props = []
            for propstat in entry.findall('{DAV:}propstat'):
                if ' 200 ' in (propstat.findtext('{DAV:}status') or ''):
                    prop = propstat.find('{DAV:}prop')
                    if prop is not None:
                        props.append(prop)
            entries.append({'href': entry.findtext('{DAV:}href'), 'etag': next((p.findtext('{DAV:}getetag') for p in props if p.findtext('{DAV:}getetag')), None)})
        return entries

    def read(self, path, etag=None):
        headers = {'If-None-Match': etag} if etag else {}
        return self.request('read-revalidate' if etag else 'read', 'GET', path, headers=headers)

    def create(self, path, data):
        return self.request('create', 'PUT', path, data, {'If-None-Match': '*', 'Content-Type': 'text/plain'})

    def replace(self, path, data, etag):
        if not etag or etag.startswith('W/'):
            raise ProtocolError('A strong ETag is required for a conditional replacement.')
        return self.request('replace-conditional', 'PUT', path, data, {'If-Match': etag, 'Content-Type': 'text/plain'})

    def delete(self, path, etag):
        if not etag or etag.startswith('W/'):
            raise ProtocolError('Cleanup requires the current strong ETag.')
        return self.request('cleanup', 'DELETE', path, headers={'If-Match': etag})


class FileStation:
    def __init__(self, transport, username, password, root):
        self.transport = transport
        self.username = username
        self.password = password
        self.root = '/' + root.strip('/')
        self.apis = {}
        self.sid = None

    def discover(self):
        query = urlencode({'api': 'SYNO.API.Info', 'version': '1', 'method': 'query', 'query': 'SYNO.API.Auth,SYNO.FileStation.List,SYNO.FileStation.Search,SYNO.FileStation.Download,SYNO.FileStation.Upload,SYNO.FileStation.Delete'})
        status, _, data = self.transport.request('api-discovery', 'GET', '/webapi/query.cgi?' + query)
        require_status(status, (200,))
        result = json.loads(data)
        if not result.get('success'):
            raise ProtocolError('File Station API discovery failed.')
        self.apis = result['data']
        return sorted(self.apis)

    def api(self, name, method, **params):
        if name not in self.apis:
            raise ProtocolError(f'Required API is unavailable: {name}.')
        info = self.apis[name]
        version = min(info['maxVersion'], 6 if name == 'SYNO.API.Auth' else 3 if name in ('SYNO.FileStation.Upload', 'SYNO.FileStation.Delete') else 2)
        values = {'api': name, 'version': str(version), 'method': method, **params}
        if self.sid:
            values['_sid'] = self.sid
        body = urlencode(values).encode()
        status, _, data = self.transport.request(name.removeprefix('SYNO.') + ':' + method, 'POST', '/webapi/' + info['path'], body, {'Content-Type': 'application/x-www-form-urlencoded'})
        require_status(status, (200,))
        result = json.loads(data)
        if not result.get('success'):
            code = result.get('error', {}).get('code', 'unknown')
            raise ProtocolError(f'{name} returned API error {code}.')
        return result.get('data', {})

    def login(self):
        data = self.api('SYNO.API.Auth', 'login', account=self.username, passwd=self.password, session='FileStation', format='sid')
        self.sid = data['sid']

    def logout(self):
        if self.sid:
            try:
                self.api('SYNO.API.Auth', 'logout', session='FileStation')
            finally:
                self.sid = None

    def list(self):
        return self.api('SYNO.FileStation.List', 'list', folder_path=self.root, offset=0, limit=50, additional=json.dumps(['size', 'time', 'perm']))

    def search(self, pattern):
        task_id = self.api('SYNO.FileStation.Search', 'start', folder_path=json.dumps([self.root]), recursive='true', pattern=pattern)['taskid']
        results = []
        try:
            for _ in range(20):
                result = self.api('SYNO.FileStation.Search', 'list', taskid=task_id, offset=0, limit=100)
                if result.get('finished'):
                    results = result.get('files', [])
                    return {'count': len(results), 'total': result.get('total'), 'finished': True}
                time.sleep(.25)
            return {'finished': False, 'reason': 'Spike polling limit reached.'}
        finally:
            # Stop and clean even if the search is interrupted or the poll deadline expires.
            try:
                self.api('SYNO.FileStation.Search', 'stop', taskid=task_id)
            finally:
                self.api('SYNO.FileStation.Search', 'clean', taskid=task_id)

    def read(self, path):
        info = self.apis['SYNO.FileStation.Download']
        values = {'api': 'SYNO.FileStation.Download', 'version': str(min(info['maxVersion'], 2)), 'method': 'download', 'path': json.dumps([path]), 'mode': 'download', '_sid': self.sid}
        # Cookie keeps the authenticated session out of the download URL.
        values.pop('_sid')
        status, headers, data = self.transport.request('download', 'GET', '/webapi/' + info['path'] + '?' + urlencode(values), headers={'Cookie': 'id=' + self.sid})
        require_status(status, (200,))
        if headers.get('content-type', '').startswith('application/json'):
            result = json.loads(data)
            if result.get('success') is False:
                raise ProtocolError(f'Download failed with API error {result.get("error", {}).get("code", "unknown")}.')
        return data

    def upload(self, path, data, overwrite=False):
        info = self.apis['SYNO.FileStation.Upload']
        version = min(info['maxVersion'], 3)
        boundary = 'sushii-' + secrets.token_hex(12)
        folder, name = path.rsplit('/', 1)
        fields = {'api': 'SYNO.FileStation.Upload', 'version': str(version), 'method': 'upload', 'path': folder, 'create_parents': 'false', '_sid': self.sid}
        # Missing overwrite means fail on existing file; "skip" is not a successful create.
        if overwrite:
            fields['overwrite'] = 'overwrite' if version >= 3 else 'true'
        parts = []
        for key, value in fields.items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
        parts.extend([f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: text/plain\r\n\r\n'.encode(), data, f'\r\n--{boundary}--\r\n'.encode()])
        status, _, response = self.transport.request('upload-overwrite' if overwrite else 'upload-create', 'POST', '/webapi/' + info['path'], b''.join(parts), {'Content-Type': 'multipart/form-data; boundary=' + boundary})
        require_status(status, (200,))
        result = json.loads(response)
        if not result.get('success'):
            raise ProtocolError(f'Upload failed with API error {result.get("error", {}).get("code", "unknown")}.')
        return result.get('data', {})

    def delete(self, path):
        return self.api('SYNO.FileStation.Delete', 'delete', path=json.dumps([path]), recursive='false')


def webdav_spike(client, writes):
    entries = client.list()
    result = {'listed_entries': len(entries), 'search': 'No portable recursive filename search in the base WebDAV interface.', 'write_test': 'not requested'}
    if not writes:
        return result
    path = client.root + '/.sushii-protocol-spike-' + secrets.token_hex(8) + '.txt'
    owned = False
    try:
        status, _, _ = client.create(path, b'first version\n')
        require_status(status, (201,))
        owned = True
        status, headers, first = client.read(path)
        require_status(status, (200,))
        if first != b'first version\n':
            raise ProtocolError('Create readback did not match.')
        etag = headers.get('etag')
        result['strong_etag'] = bool(etag and not etag.startswith('W/'))
        if not result['strong_etag']:
            result['write_test'] = 'Conditional replacement unavailable: missing strong ETag.'
            return result
        status, _, _ = client.read(path, etag)
        result['unchanged_read_status'] = status
        # Different bytes but SAME SIZE; catches validators based only on file length.
        status, _, _ = client.replace(path, b'other version\n', etag)
        require_status(status, (200, 201, 204))
        status, _, _ = client.replace(path, b'stale content\n', etag)
        result['stale_write_status'] = status
        _, _, current = client.read(path)
        result['stale_write_rejected'] = status == 412 and current == b'other version\n'
        result['write_test'] = 'passed' if result['stale_write_rejected'] else 'FAILED: stale write was not safely rejected'
        return result
    finally:
        if owned:
            _, headers, _ = client.read(path)
            current_etag = headers.get('etag')
            if current_etag and not current_etag.startswith('W/'):
                status, _, _ = client.delete(path, current_etag)
                result['cleanup_status'] = status
            else:
                result['cleanup_required'] = path  # Never delete without a checked version.


def filestation_spike(client, writes, pattern):
    client.discover()
    client.login()
    result = {}
    path = client.root + '/.sushii-protocol-spike-' + secrets.token_hex(8) + '.txt'
    owned = False
    try:
        listing = client.list()
        result.update(listed_entries=len(listing.get('files', [])), total_entries=listing.get('total'))
        result['remote_filename_search'] = client.search(pattern)
        result['conditional_replace'] = 'Upload API exposes overwrite/skip, not an expected-version precondition.'
        if writes:
            client.upload(path, b'first version\n')
            owned = True
            if client.read(path) != b'first version\n':
                raise ProtocolError('Create readback did not match.')
            client.upload(path, b'other version\n', overwrite=True)
            result['replace_readback_verified'] = client.read(path) == b'other version\n'
            if not result['replace_readback_verified']:
                raise ProtocolError('Replacement readback did not match.')
            result['write_test'] = 'Create/read/replace tested; no atomic stale-version rejection claimed.'
        return result
    finally:
        try:
            if owned:
                result['cleanup'] = client.delete(path)
        finally:
            client.logout()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, help='Private JSON config outside the repository.')
    parser.add_argument('--writes', action='store_true', help='Create, replace and delete ONLY uniquely named spike files in the configured root.')
    parser.add_argument('--output', required=True, help='Sanitized JSON report path; no original document contents.')
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    password = os.environ[config['password_env']] if 'password_env' in config else config['password']
    report = {'measurement_location': config.get('measurement_location', 'unspecified; do not infer WAN latency'), 'protocols': {}}
    for name, endpoint in config.get('endpoints', {}).items():
        transport = Transport(endpoint['url'], config.get('ca_file'), endpoint.get('certificate_sha256'))
        try:
            client = WebDAV(transport, config['username'], password, endpoint['root']) if name == 'webdav' else FileStation(transport, config['username'], password, endpoint['root'])
            result = webdav_spike(client, args.writes) if name == 'webdav' else filestation_spike(client, args.writes, config.get('search_pattern', '*.md'))
            report['protocols'][name] = {'result': result}
        except Exception as error:
            # Do not print arbitrary exception strings: they may contain credentials or session IDs.
            safe = str(error) if isinstance(error, ProtocolError) else type(error).__name__
            report['protocols'][name] = {'error': safe}
        finally:
            report['protocols'][name]['requests'] = transport.measurements
            transport.close()
    Path(args.output).write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
    failed = any('error' in p for p in report['protocols'].values())
    if args.writes and 'webdav' in report['protocols']:
        failed |= report['protocols']['webdav'].get('result', {}).get('stale_write_rejected') is not True
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
