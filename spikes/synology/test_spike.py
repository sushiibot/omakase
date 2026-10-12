import hashlib
import importlib.util
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
import ssl
import subprocess
import tempfile
import threading
import unittest
from urllib.parse import parse_qs, urlsplit

spec = importlib.util.spec_from_file_location('spike', Path(__file__).with_name('spike.py'))
spike = importlib.util.module_from_spec(spec)
spec.loader.exec_module(spike)


class NAS(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *_):
        pass

    def reply(self, status, body=b'', headers=None):
        self.send_response(status)
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def json(self, value):
        self.reply(200, json.dumps(value).encode(), {'Content-Type': 'application/json'})

    def etag(self, path):
        return '"' + hashlib.sha256(self.server.files[path]).hexdigest() + '"'

    def do_PROPFIND(self):
        self.rfile.read(int(self.headers.get('Content-Length', 0)))
        self.server.methods.append(('PROPFIND', self.path))
        self.reply(207, b'<d:multistatus xmlns:d="DAV:"><d:response><d:href>/public/Property/</d:href><d:propstat><d:prop><d:getetag>"root"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>')

    def do_PUT(self):
        data = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        self.server.methods.append(('PUT', self.path))
        exists = self.path in self.server.files
        if self.headers.get('If-None-Match') == '*' and exists:
            return self.reply(412)
        if not self.server.ignore_condition and self.headers.get('If-Match') and (not exists or self.headers['If-Match'] != self.etag(self.path)):
            return self.reply(412)
        self.server.files[self.path] = data
        self.reply(204 if exists else 201)

    def do_GET(self):
        self.server.methods.append(('GET', urlsplit(self.path).path))
        if self.path.startswith('/webapi/query.cgi'):
            apis = {name: {'path': 'entry.cgi', 'minVersion': 1, 'maxVersion': 6 if name == 'SYNO.API.Auth' else 3} for name in ('SYNO.API.Auth', 'SYNO.FileStation.List', 'SYNO.FileStation.Search', 'SYNO.FileStation.Download', 'SYNO.FileStation.Upload', 'SYNO.FileStation.Delete')}
            return self.json({'success': True, 'data': apis})
        if self.path.startswith('/webapi/entry.cgi'):
            values = parse_qs(urlsplit(self.path).query)
            if self.headers.get('Cookie') != 'id=test-session':
                return self.json({'success': False, 'error': {'code': 119}})
            path = json.loads(values['path'][0])[0]
            return self.reply(200, self.server.files[path], {'Content-Type': 'application/octet-stream'})
        if self.path not in self.server.files:
            return self.reply(404)
        etag = self.etag(self.path)
        if self.headers.get('If-None-Match') == etag:
            return self.reply(304, headers={'ETag': etag})
        self.reply(200, self.server.files[self.path], {'ETag': etag})

    def do_DELETE(self):
        self.server.methods.append(('DELETE', self.path))
        if self.path not in self.server.files or self.headers.get('If-Match') != self.etag(self.path):
            return self.reply(412)
        del self.server.files[self.path]
        self.reply(204)

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        self.server.methods.append(('POST', self.path))
        if self.headers.get('Content-Type', '').startswith('multipart/'):
            boundary = self.headers['Content-Type'].split('boundary=')[1].encode()
            parts = body.split(b'--' + boundary)
            fields = {}
            data = None
            name = None
            for part in parts:
                if b'Content-Disposition:' not in part:
                    continue
                header, content = part.split(b'\r\n\r\n', 1)
                content = content.removesuffix(b'\r\n')
                if b'filename=' in header:
                    name = re.search(rb'filename="([^"]+)"', header).group(1).decode()
                    data = content
                else:
                    key = re.search(rb'name="([^"]+)"', header).group(1).decode()
                    fields[key] = content.decode()
            if self.headers.get('Cookie') != 'id=test-session':
                return self.json({'success': False, 'error': {'code': 119}})
            path = fields['path'] + '/' + name
            if path in self.server.files and fields.get('overwrite') != 'overwrite':
                return self.json({'success': False, 'error': {'code': 1800}})
            self.server.files[path] = data
            return self.json({'success': True})
        values = {k: v[0] for k, v in parse_qs(body.decode()).items()}
        name, method = values['api'], values['method']
        if name == 'SYNO.API.Auth':
            if method == 'login':
                return self.json({'success': True, 'data': {'sid': 'test-session'}})
            self.server.logged_out = True
            return self.json({'success': True})
        if values.get('_sid') != 'test-session':
            return self.json({'success': False, 'error': {'code': 119}})
        if name == 'SYNO.FileStation.List':
            return self.json({'success': True, 'data': {'files': [], 'total': 0}})
        if name == 'SYNO.FileStation.Search':
            if method == 'start':
                return self.json({'success': True, 'data': {'taskid': 'search-1'}})
            if method == 'list':
                if self.server.search_fail:
                    return self.json({'success': False, 'error': {'code': 407}})
                return self.json({'success': True, 'data': {'finished': True, 'files': [], 'total': 0}})
            self.server.search_cleaned |= method == 'clean'
            return self.json({'success': True})
        if name == 'SYNO.FileStation.Delete':
            del self.server.files[json.loads(values['path'])[0]]
            return self.json({'success': True})
        self.json({'success': False, 'error': {'code': 103}})


class SpikeTests(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), NAS)
        self.server.files = {}
        self.server.methods = []
        self.server.ignore_condition = False
        self.server.search_fail = False
        self.server.search_cleaned = False
        self.server.logged_out = False
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.transport = spike.Transport(f'http://127.0.0.1:{self.server.server_port}')

    def tearDown(self):
        self.transport.close()
        self.server.shutdown()
        self.server.server_close()

    def test_webdav_conditional_read_and_write_preserve_newer_content(self):
        result = spike.webdav_spike(spike.WebDAV(self.transport, 'test', 'secret', '/public/Property'), True)
        self.assertEqual(result['unchanged_read_status'], 304)
        self.assertTrue(result['stale_write_rejected'])
        self.assertEqual(result['cleanup_status'], 204)
        self.assertEqual(self.server.files, {})

    def test_webdav_spike_detects_server_that_ignores_if_match(self):
        self.server.ignore_condition = True
        result = spike.webdav_spike(spike.WebDAV(self.transport, 'test', 'secret', '/public/Property'), True)
        self.assertFalse(result['stale_write_rejected'])
        self.assertIn('FAILED', result['write_test'])
        self.assertEqual(self.server.files, {})

    def test_filestation_search_and_write_cleanup(self):
        result = spike.filestation_spike(spike.FileStation(self.transport, 'test', 'secret', '/public/Property'), True, '*.md')
        self.assertTrue(result['remote_filename_search']['finished'])
        self.assertTrue(result['replace_readback_verified'])
        self.assertTrue(self.server.search_cleaned)
        self.assertTrue(self.server.logged_out)
        self.assertEqual(self.server.files, {})
        self.assertNotIn('test-session', json.dumps(self.transport.measurements))

    def test_search_failure_still_cleans_remote_task_and_logs_out(self):
        self.server.search_fail = True
        with self.assertRaises(spike.ProtocolError):
            spike.filestation_spike(spike.FileStation(self.transport, 'test', 'secret', '/public/Property'), False, '*.md')
        self.assertTrue(self.server.search_cleaned)
        self.assertTrue(self.server.logged_out)

    def test_read_only_spikes_never_write(self):
        spike.webdav_spike(spike.WebDAV(self.transport, 'test', 'secret', '/public/Property'), False)
        spike.filestation_spike(spike.FileStation(self.transport, 'test', 'secret', '/public/Property'), False, '*.md')
        self.assertFalse(any(method in ('PUT', 'DELETE') for method, _ in self.server.methods))
        self.assertEqual(self.server.files, {})

    def test_failed_certificate_pin_sends_no_http_request(self):
        # A second local TLS fixture verifies that pin rejection precedes credentials.
        with tempfile.TemporaryDirectory() as directory:
            cert = Path(directory) / 'cert.pem'
            key = Path(directory) / 'key.pem'
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-keyout', str(key), '-out', str(cert)], check=True, capture_output=True)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(cert, key)
            server = ThreadingHTTPServer(('127.0.0.1', 0), NAS)
            server.methods = []
            server.socket = context.wrap_socket(server.socket, server_side=True)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            transport = spike.Transport(f'https://127.0.0.1:{server.server_port}', certificate_sha256='0' * 64)
            try:
                with self.assertRaises(spike.ProtocolError):
                    spike.WebDAV(transport, 'test', 'secret', '/public/Property').list()
                self.assertEqual(server.methods, [])
            finally:
                transport.close()
                server.shutdown()
                server.server_close()


if __name__ == '__main__':
    unittest.main()
