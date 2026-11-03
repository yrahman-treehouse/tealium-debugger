#!/usr/bin/env python3
"""Upload a built zip to the Chrome Web Store and submit it for publishing.

Uses Chrome Web Store API v2 with a service account (v1.1 was retired on
2026-10-15). Standard library plus the `openssl` binary for the RS256
signature, so it needs no pip install on a GitHub runner.

    python3 extension/cws_publish.py dist/tealium-debugger-10.1.zip

Environment:
    CWS_SERVICE_ACCOUNT_KEY  the service account's JSON key, as text
    CWS_PUBLISHER_ID         publisher id from the Developer Dashboard
    CWS_EXTENSION_ID         the item's 32-letter extension id
    CWS_DRY_RUN=1            optional: stop after getting a token
"""
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

SCOPE = 'https://www.googleapis.com/auth/chromewebstore'
TOKEN_URL = 'https://oauth2.googleapis.com/token'
API = 'https://chromewebstore.googleapis.com'


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('ascii')


def access_token(key):
    """Service-account JWT bearer flow (RFC 7523), signed with openssl."""
    now = int(time.time())
    head = b64url(json.dumps({'alg': 'RS256', 'typ': 'JWT'}).encode())
    claims = b64url(json.dumps({
        'iss': key['client_email'], 'scope': SCOPE, 'aud': TOKEN_URL,
        'iat': now, 'exp': now + 600,
    }).encode())
    signing_input = (head + '.' + claims).encode('ascii')
    fd, pem = tempfile.mkstemp(suffix='.pem')
    try:
        with os.fdopen(fd, 'w') as f:
            f.write(key['private_key'])
        sig = subprocess.run(['openssl', 'dgst', '-sha256', '-sign', pem],
                             input=signing_input, capture_output=True, check=True).stdout
    finally:
        os.remove(pem)
    body = urllib.parse.urlencode({
        'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        'assertion': signing_input.decode('ascii') + '.' + b64url(sig),
    }).encode()
    return call('POST', TOKEN_URL, body,
                {'Content-Type': 'application/x-www-form-urlencoded'})['access_token']


def call(method, url, body=None, headers=None):
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            raw = res.read()
    except urllib.error.HTTPError as e:
        sys.exit('%s %s -> HTTP %s\n%s' % (method, url.split('?')[0], e.code,
                                          e.read().decode('utf-8', 'replace')))
    return json.loads(raw or b'{}')


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    zip_path = sys.argv[1]
    key = json.loads(os.environ['CWS_SERVICE_ACCOUNT_KEY'])
    item = 'publishers/%s/items/%s' % (os.environ['CWS_PUBLISHER_ID'],
                                       os.environ['CWS_EXTENSION_ID'])
    token = access_token(key)
    print('token: ok for', key['client_email'])
    if os.environ.get('CWS_DRY_RUN') == '1':
        return
    auth = {'Authorization': 'Bearer ' + token}

    with open(zip_path, 'rb') as f:
        up = call('POST', '%s/upload/v2/%s:upload?uploadType=media' % (API, item), f.read(),
                  dict(auth, **{'Content-Type': 'application/zip'}))
    state = up.get('uploadState')
    print('upload:', state, up.get('crxVersion', ''))
    for _ in range(30):                       # async upload: poll for up to ~5 min
        if state != 'IN_PROGRESS':
            break
        time.sleep(10)
        state = call('GET', '%s/v2/%s:fetchStatus' % (API, item),
                     headers=auth).get('lastAsyncUploadState')
        print('upload:', state)
    if state != 'SUCCEEDED':
        sys.exit('upload did not succeed: %s\n%s' % (state, json.dumps(up, indent=2)))

    pub = call('POST', '%s/v2/%s:publish' % (API, item), b'{}',
               dict(auth, **{'Content-Type': 'application/json'}))
    print('publish:', pub.get('state'))
    for w in (pub.get('warningInfo') or {}).get('warnings', []):
        print('warning:', w.get('reason'), '-', w.get('description'))


if __name__ == '__main__':
    main()
