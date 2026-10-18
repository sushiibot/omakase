"""Workspace-owned Camoufox worker; NDJSON pipes, no listener or detached daemon."""
import base64
import contextlib
import io
import json
import os
import sys
import time

from camoufox.sync_api import Camoufox
from camoufox.fingerprints import generate_fingerprint
from camoufox.addons import DefaultAddons
from browser_refs import RefRegistry, UNNAMED_RE
from pathlib import Path
from PIL import Image

os.umask(0o077)
profile = sys.argv[1] or None
launcher = None
context = None
browser = None
page = None
refs = RefRegistry()
seq = 0


def launch():
    global launcher, context, browser, page
    kwargs = {"headless": True, "enable_cache": True, "os": "linux",
              "executable_path": os.environ.get("CAMOUFOX_EXECUTABLE_PATH", "/opt/camoufox-browser/camoufox"),
              "addons": ["/opt/ublock-origin"], "exclude_addons": [DefaultAddons.UBO]}
    if profile:
        os.makedirs(profile, mode=0o700, exist_ok=True)
        identity_path = Path(profile) / "identity.json"
        if identity_path.exists():
            identity = json.loads(identity_path.read_text())
        else:
            identity = generate_fingerprint(os="linux")
            temporary = identity_path.with_suffix(".tmp")
            temporary.write_text(json.dumps(identity))
            temporary.replace(identity_path)
        kwargs["fingerprint"] = identity
        kwargs.update(persistent_context=True, user_data_dir=profile)
    launcher = Camoufox(**kwargs)
    browser = launcher.__enter__()
    context = browser if profile else browser.new_context()
    page = context.pages[0] if context.pages else context.new_page()
    context.set_default_timeout(15000)
    context.set_default_navigation_timeout(30000)
    context.on("page", on_page)
    page.on("dialog", lambda dialog: dialog.dismiss())


def on_page(new_page):
    global page, refs
    page = new_page
    refs = RefRegistry()
    page.on("dialog", lambda dialog: dialog.dismiss())


def target(value):
    if not value.startswith("@"):
        return page.locator(value)
    entry = refs.resolve(value)
    if not entry:
        raise ValueError("Element reference expired. Take a new snapshot.")
    locator = page.get_by_role(entry.role, name=entry.name or UNNAMED_RE, exact=True)
    if refs.scope:
        root = page.locator(refs.scope)
        locator = root.and_(locator).or_(root.get_by_role(entry.role, name=entry.name or UNNAMED_RE, exact=True))
    return locator.nth(entry.nth)


def command(args):
    global page, refs, launcher
    action, *rest = args
    if action == "close":
        if launcher:
            launcher.__exit__(None, None, None)
            launcher = None
        return "Closed"
    if page is None:
        launch()
    if action == "open":
        page.goto(rest[0], wait_until="domcontentloaded")
        refs = RefRegistry()
        return {"url": page.url, "title": page.title()}
    if action == "snapshot":
        scope = rest[rest.index("-s") + 1] if "-s" in rest else None
        tree = (page.locator(scope) if scope else page.locator("body")).aria_snapshot()
        return refs.build_from_snapshot(tree, interactive_only="-i" in rest, scope=scope)
    if action in ("click", "dblclick", "hover", "check", "uncheck"):
        getattr(target(rest[0]), action)()
    elif action in ("fill", "type"):
        getattr(target(rest[0]), "fill" if action == "fill" else "press_sequentially")(rest[1])
    elif action == "select":
        target(rest[0]).select_option(rest[1])
    elif action == "press":
        page.keyboard.press(rest[0])
    elif action == "scroll":
        amount = int(rest[1]) if len(rest) > 1 else 500
        direction = rest[0]
        page.mouse.wheel(amount * (-1 if direction == "left" else 1) if direction in ("left", "right") else 0,
                         amount * (-1 if direction == "up" else 1) if direction in ("up", "down") else 0)
    elif action == "get":
        if rest[0] == "url": return page.url
        if rest[0] == "title": return page.title()
        if rest[0] == "text": return target(rest[1] if len(rest) > 1 else "body").inner_text()
        if rest[0] == "value": return target(rest[1]).input_value()
        if rest[0] == "attr": return target(rest[1]).get_attribute(rest[2])
        raise ValueError("Unsupported get command")
    elif action == "read":
        return page.locator("body").inner_text()
    elif action == "is":
        return getattr(target(rest[1]), "is_" + rest[0])()
    elif action == "wait":
        if rest[0].isdigit(): page.wait_for_timeout(min(int(rest[0]), 30000))
        elif rest[0] == "--url": page.wait_for_url(rest[1])
        elif rest[0] == "--load": page.wait_for_load_state(rest[1])
        else: target(rest[0]).wait_for()
    elif action in ("back", "forward", "reload"):
        getattr(page, {"back": "go_back", "forward": "go_forward", "reload": "reload"}[action])(wait_until="domcontentloaded")
        refs = RefRegistry()
    elif action == "eval":
        return page.evaluate(rest[0])
    elif action == "screenshot":
        path = next((a for a in rest if not a.startswith("--")), None)
        if not path: raise ValueError("Provide an output path for screenshots")
        page.screenshot(path=path, full_page="--full" in rest)
        return path
    elif action == "upload":
        target(rest[0]).set_input_files(rest[1:])
    elif action == "tab":
        if not rest or rest[0] == "list": return [{"index": i, "url": p.url, "active": p == page} for i, p in enumerate(context.pages)]
        if rest[0] == "new":
            page = context.new_page()
            if len(rest) > 1: page.goto(rest[1], wait_until="domcontentloaded")
        elif rest[0] == "close":
            page.close()
            page = context.pages[-1] if context.pages else context.new_page()
        else: page = context.pages[int(rest[0])]
        refs = RefRegistry()
    else:
        raise ValueError("Unsupported Camoufox action. Use open, snapshot, click, fill, press, scroll, get, read, wait, tab, upload, or screenshot.")
    return {"url": page.url}


def handle(request):
    global seq
    if "accountFill" in request:
        if page is None: raise ValueError("Account fill failed")
        page.evaluate(request["script"], request["accountFill"])
        return True
    if request.get("capture"):
        data = page.screenshot(type="jpeg", quality=60, scale="css", timeout=5000)
        size = Image.open(io.BytesIO(data)).size
        seq += 1
        return {"url": page.url, "frame": {"seq": seq, "data": base64.b64encode(data).decode(), "width": size[0], "height": size[1], "capturedAt": int(time.time() * 1000)}}
    if "input" in request:
        event = request["input"]
        if event["kind"] == "click": page.mouse.click(event["x"], event["y"])
        elif event["kind"] == "text": page.keyboard.insert_text(event["text"])
        elif event["kind"] == "key": page.keyboard.press(event["key"])
        else: page.mouse.wheel(0, -500 if event["direction"] == "up" else 500)
        return None
    return command(request["args"])


try:
    for line in sys.stdin:
        try:
            request = json.loads(line)
            # Dependencies may print diagnostics. Stdout is exclusively the protocol.
            with contextlib.redirect_stdout(sys.stderr):
                result = handle(request)
            print(json.dumps({"ok": True, "result": result}), flush=True)
            if request.get("args") == ["close"]: break
        except Exception as error:
            # Owner input errors must never echo typed credentials.
            message = "Browser input failed. Refresh the preview and try again." if "input" in request else ("Account fill failed" if "accountFill" in request else str(error)[:2000])
            print(json.dumps({"ok": False, "error": message}), flush=True)
finally:
    if launcher:
        with contextlib.redirect_stdout(sys.stderr):
            launcher.__exit__(None, None, None)
