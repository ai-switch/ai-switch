---
title: Remote Access and HTTPS
description: Reach AI Switch over a public Tailscale Funnel address, and generate and trust a self-signed root certificate for the local pool proxy. Includes real certificate paths, per-platform trust commands, and default states.
---

# Remote Access and HTTPS

This page covers two independent things. Separate them before reading on:

- **Remote access**: letting other devices reach the AI Switch management UI on your machine (the web service, port `19527` by default).
- **Local pool HTTPS**: making the local routing proxy (port `19527` by default) serve `https://` for clients that only accept HTTPS upstream URLs.

Different ports, different certificate stories. Do not conflate them.

## Remote access: public Tailscale Funnel

AI Switch ships no networking component of its own. It drives the **system-installed `tailscale` CLI** and publishes the local Web service over Tailscale Funnel as a public HTTPS address:

```text
https://<machine>.<your-tailnet>.ts.net
```

The prerequisite is that **you install Tailscale on this machine yourself**:

- Install it from <https://tailscale.com/download> so the local `tailscale` command is available.
- When the CLI is missing, the settings panel shows an **Install Tailscale** link.
- The tailnet must have **MagicDNS** and **HTTPS certificates** enabled and allow **Funnel** (a policy setting). A missing MagicDNS certificate surfaces as "enable MagicDNS"; an unapproved device surfaces as "this device needs approval from your Tailscale administrator".

**Your phone does not need Tailscale.** A public Funnel address is reachable from any device, so a phone (or anything else) only needs a browser and the access token. The uni-app client does not embed a Tailscale SDK either.

Tailscale does not change AI Switch's own authentication: **the access token is still required**. Tailscale solves reachability and channel encryption; it is not a substitute for application-level authorisation.

Use this **public HTTPS** address as the single cross-platform baseline: H5 needs CORS, and a mini-program needs the hostname on its allowed request-domain list.

## Enabling public access in one flow

The entry point is the **Tailscale public access** section inside **Settings → Web Service** in the desktop app:

1. Make sure the **shared service port** is running (the one-click flow starts the Web service for you when you click enable).
2. Click **Enable public access**.
3. The app runs `tailscale up` when needed, streams the `login.tailscale.com` authorization URL to the UI and opens it in your browser; once authorized it continues automatically.
4. On success the UI shows the public address, shaped like `https://<machine>.<your-tailnet>.ts.net`, with copy and mobile-pairing actions.

Under the hood it runs `tailscale funnel --bg --https=443`, publishing `http://127.0.0.1:<port>` on HTTPS 443. Funnel only allows ports 443, 8443, and 10000; the app always uses 443.

### The other sign-in path: auth keys

If this machine has no browser — for example a headless host you reach over SSH — paste a Tailscale **auth key** into the same area and click connect with auth key. The key is used once (`tailscale up --authkey`) and is **never written to disk**; the node connection itself lives in the system `tailscaled` state.

### Sign-in never happens on its own

Worth stressing: **the app never signs in to Tailscale unattended at startup.**

Only after you have **enabled public access and left it enabled** will a restart re-publish it once the Web service rebinds; if re-authorization is required it stops and waits for you to click once.

In other words, installing the app does not join you to any network. You have to perform an explicit authorisation step.

## Ownership and conflicts

The app only ever removes the Funnel mapping **it created itself**:

- On enable it records the mapping it owns (hostname plus port) in the app database.
- **Disabling public access** removes only that mapping; if the mapping on 443 is no longer the app's, the UI reports that it cannot be removed here.
- If 443 already carries a Funnel mapping **you configured outside the app**, the app does not overwrite it — it reports a **conflict** and asks you to resolve it in Tailscale first.
- On restart, if it was previously enabled, the app re-publishes after the Web service is ready (non-interactively; it stops and waits if sign-in is required).

## Pairing a phone with a QR code

In the desktop Tailscale public-access section, choose **Show pairing QR**, then choose **Scan import** while adding or editing a real instance in the mobile App. The QR contains the remote URL, a short-lived single-use pairing code, and its expiry; **it never contains the long-lived Web Service token**. Redeeming the code returns an independent mobile token.

Scanning only fills the form. The mobile App still lets you edit the URL and enter or replace a token manually. Pairing codes are single-use and expire; generate a new one when needed. **The phone does not need Tailscale to use this address** — it is an ordinary public HTTPS URL any browser can open. It does require public access to be on and the machine to be able to reach that address (the app checks reachability before creating a pairing code; pick **Generate anyway** when the phone is on another network).

## What Funnel requires

- **Your Tailscale account must permit Funnel.** That is a tailnet policy setting, enabled in the Tailscale admin console.
- **MagicDNS and HTTPS certificates are required.** The address uses the MagicDNS hostname and the HTTPS certificate is issued for it; do not use `100.x.y.z`, which fails hostname verification.
- **HTTPS comes from Tailscale**, which issues and renews the certificate. You do not supply one.
- **The access token still applies.** Anyone can reach the address, but without the token they get nothing. At that point the token is the only door.
- **The Web service must listen on `127.0.0.1` or `0.0.0.0`.** Any other bind address cannot be handed to Funnel.

## Bringing your own certificate for the web service

Without Tailscale, the desktop app can select `0.0.0.0` and serve the LAN directly over HTTP; TLS is no longer mandatory. This exposes every Web command and leaves the token as the only protection, so bring your own TLS across untrusted networks. The standalone server's non-loopback plaintext restriction is unchanged.

- Desktop: edit `~/.ai-switch/web-service.json` and set `tlsEnabled`, `tlsCertPath`, and `tlsKeyPath` (there are no UI fields for these three), then restart the web service.
- Standalone server: set the environment variables `AI_SWITCH_TLS_CERT_PATH` and `AI_SWITCH_TLS_KEY_PATH`.

Both paths must be supplied together; only one fails with `web.tls_paths_incomplete`. See [Web Service Mode](/en/deploy/web-service) and [Standalone Server](/en/deploy/standalone-server).

## Local pool HTTPS

This has nothing to do with remote access. It solves a different problem: **some clients only accept `https://` upstream URLs**, while the AI Switch local routing proxy defaults to `http://127.0.0.1:19527`. To bridge that, the app can generate a self-signed certificate chain so the local proxy serves HTTPS **in addition to** HTTP.

HTTPS does not replace HTTP — it takes a port of its own. HTTP keeps serving where it was and HTTPS binds the next free port up from it, normally `http://127.0.0.1:19527` alongside `https://127.0.0.1:19528`. Client configs always receive the HTTP address, because clients that ship their own CA bundle (curl on macOS/Linux, Node-based CLIs) never see the root certificate in the system trust store and would only fail certificate validation. So: **use the HTTP endpoint unless a client genuinely demands TLS, and paste the HTTPS one by hand when it does.** Both addresses are shown in the config-write dialog and in the HTTPS panel.

### It is off by default

The defaults in `route-proxy-https.json` are `enabled: false` and `autoStart: false`. Meaning: **unless you turn it on yourself, local HTTPS stays off and no certificate is generated**. Installing the app writes nothing to your system trust store.

The proxy itself always binds `127.0.0.1`, starting at port `19527` and walking up to the next free port if that one is taken. Enabling HTTPS does not make it listen on an external address; the TLS listener is loopback-only too, and if it cannot start the reason is recorded while HTTP keeps serving.

### Where the certificates live

Once enabled, the certificate material is generated in `~/.ai-switch/certs/route-proxy/`:

| File | Contents |
| --- | --- |
| `root-ca.pem` | Self-signed root certificate — this is the file you import into the trust store |
| `root-ca-key.pem` | Root private key (mode 0600 on Unix) |
| `server-cert.pem` | The server certificate the proxy actually serves |
| `server-key.pem` | Server private key (mode 0600 on Unix) |
| `metadata.json` | Root SHA-256 fingerprint, SHA-1 thumbprint, validity dates |

Certificate parameters: the root CN is `AI Switch Route Proxy Root CA` with 3650 days of validity; the server CN is `AI Switch Route Proxy localhost` with 823 days, and its SANs are exactly `localhost` and `127.0.0.1`. Both certificates are backdated by one day to tolerate a lagging client clock, so the server certificate presents a 824-day validity span — deliberately under the 825-day ceiling that macOS and iOS enforce on TLS server certificates, including those signed by a custom root. Because there is no external hostname in the SAN list, this material **is only valid for local access** — it cannot be reused for another machine.

### Trusting it

Everything happens in the **local pool HTTPS** panel in the desktop app. The available actions are:

- **Generate and import root certificate**: generate the material and write it to the system trust store in one step.
- **Re-import root certificate**: for when the files are still there but the trust state was lost (for example after the trust store was cleaned).
- **Regenerate certificates**: retire the old material and produce a fresh set. Generation happens in a temporary directory with an atomic swap, rolling back to `.backup` on failure, so a half-written state is never left behind.
- **Uninstall root certificate**: remove it from the system trust store while keeping the files.
- **Delete local certificate material**: delete the files entirely, allowed only once HTTPS is off and the root certificate has been uninstalled.
- **Open certificate directory**: open that directory in your file manager (desktop only).

The panel also shows the root fingerprint, expiry date, certificate directory, and the current trust status (system-trusted, NSS-trusted, partially trusted, untrusted, or unknown).

If automatic import fails — usually from insufficient privileges or a non-standard distribution — the panel prints **manual trust steps**. The commands it uses, per platform:

```powershell
certutil.exe -user -addstore Root "$HOME\.ai-switch\certs\route-proxy\root-ca.pem"
```

That writes to the **current user's** trust store (`-user`), so no administrator privileges are needed.

macOS writes to the login keychain:

```bash
security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db \
  ~/.ai-switch/certs/route-proxy/root-ca.pem
```

Omitting `-d` targets the **user** trust domain, so this needs no administrator privileges — but macOS still asks for your password before changing trust settings. Dismissing that prompt imports the certificate without trusting it, which browsers then report as `ERR_CERT_AUTHORITY_INVALID`. AI Switch reports that state as untrusted, so if trust status stays untrusted after a successful import, re-run the command and complete the prompt. To undo it, remember `-t` — `security delete-certificate -Z <sha1> -t ~/Library/Keychains/login.keychain-db` — otherwise the trust setting outlives the certificate.

Linux varies by distribution — pick the line that matches yours:

```bash
# p11-kit (Arch, Fedora, and others)
trust anchor ~/.ai-switch/certs/route-proxy/root-ca.pem

# Debian / Ubuntu
sudo install -Dm644 ~/.ai-switch/certs/route-proxy/root-ca.pem \
  /usr/local/share/ca-certificates/ai-switch-route-proxy-root-ca.crt
sudo update-ca-certificates

# RHEL / CentOS / Fedora
sudo install -Dm644 ~/.ai-switch/certs/route-proxy/root-ca.pem \
  /etc/pki/ca-trust/source/anchors/ai-switch-route-proxy-root-ca.pem
sudo update-ca-trust extract
```

Firefox and some other NSS-based applications ignore the system trust store and need a separate import:

```bash
certutil -A -d <nss-db-path> -n "AI Switch Route Proxy Root CA" -t C,, \
  -i ~/.ai-switch/certs/route-proxy/root-ca.pem
```

The NSS nickname must match the root CN — `AI Switch Route Proxy Root CA` — because uninstall looks the certificate up by that name.

The manual steps in the panel are generated from the real paths on your machine, so copying the commands from the panel is more reliable than copying them from this page.

### Checking the HTTPS endpoint by hand

System curl is enough to see whether the HTTPS endpoint answers — on Windows, add `--ssl-no-revoke`:

```powershell
curl.exe --ssl-no-revoke --cacert "$HOME\.ai-switch\certs\route-proxy\root-ca.pem" `
  -H "Authorization: Bearer <proxy key>" https://127.0.0.1:19528/v1/models
```

curl on Windows uses Schannel, which looks up the root certificate's revocation status. A self-signed root has no CRL or OCSP distribution point, so without that flag you get `curl: (60) schannel: the revocation status is unknown` — which reads like an invalid certificate but only means the revocation status could not be fetched. With the flag it returns 200, matching what the HTTP endpoint returns.

Hitting the HTTP endpoint at the same time (`http://127.0.0.1:19527/v1/models`) should also return 200 and needs no certificate arguments at all — that is exactly what running both ports is meant to guarantee. Conversely, plain HTTP against the HTTPS port yields `curl: (1) Received HTTP/0.9 when not allowed`, because that listener only speaks TLS.

### Private keys never reach the UI

The proxy HTTPS status endpoint returns the certificate directory, the root certificate path, trust status, expiry, and the manual steps. It **never** returns private key material.

## Security notes

::: warning Ground rules for remote access
- **Every `/api/*` and `/ws/events` request needs the access token, including over Tailscale.** Tailscale is not an authentication layer; it only provides the channel.
- **Tailscale sign-in is a manual action.** The app never signs in unattended at startup; it only re-publishes after a restart when public access was enabled and the machine was previously signed in.
- **Install Tailscale on this machine before you go remote.** The app bundles no networking component; the UI offers an install link when the CLI is missing.
- **Think before binding `0.0.0.0`.** The desktop app permits plaintext startup and exposes every Web command to that network; the access token is the only protection.
- **Think harder before enabling Funnel.** That is a public address, and the token is the only door. It lets anyone on `https://<machine>.<tailnet>.ts.net` see the sign-in page.
- **The token is equivalent to shell access.** The web API includes terminal session commands, so a leaked token costs more than config disclosure.
- **The self-signed root is for this machine only.** Its SANs are just `localhost` and `127.0.0.1`. Never copy the root private key to another machine, and never use it to issue certificates for remote access.
- **Mobile token storage is platform-aware.** The App can inject an iOS Keychain / Android Keystore adapter; H5 and mini-program builds fall back to `uni` local storage for compatibility. In either case, never put the token in a QR code or a log.
- **Clean up when you are done.** After disabling local HTTPS, use the panel's uninstall and delete actions to remove the root certificate from the system trust store rather than leaving an unused root sitting there.
:::

## Next steps

- To revisit web service setup and endpoints, see [Web Service Mode](/en/deploy/web-service).
- To deploy a headless instance on a server, see [Standalone Server](/en/deploy/standalone-server).
- To understand how the local proxy routes requests, see [Protocol Routing and Bridging](/en/guide/protocol-routing).
- If something will not connect, start with the [FAQ](/en/faq).
