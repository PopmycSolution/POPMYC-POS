# POPMYC POS — Windows Code Signing

## Overview

Code signing prevents Windows SmartScreen warnings and ensures customers
can trust the installer. The signing certificate is **never** committed to
the repository.

## Required certificate

Purchase or obtain an **EV Code Signing Certificate** from a trusted CA:
- DigiCert
- Sectigo (Comodo)
- GlobalSign

An EV (Extended Validation) certificate eliminates SmartScreen warnings
immediately. Standard OV certificates require reputation building.

## How signing is configured

Code signing is activated **only** when the `CSC_LINK` environment variable
is set. If `CSC_LINK` is not set, `electron-builder` builds an unsigned
package (suitable for internal testing).

| Variable | Description |
|----------|-------------|
| `CSC_LINK` | Path or URL to the `.p12`/`.pfx` certificate file |
| `CSC_KEY_PASSWORD` | Password for the `.p12`/`.pfx` file |

### On a CI/CD system (e.g. GitHub Actions)

```yaml
env:
  CSC_LINK: ${{ secrets.WINDOWS_CERTIFICATE }}          # base64-encoded .p12
  CSC_KEY_PASSWORD: ${{ secrets.WINDOWS_CERT_PASSWORD }}
```

Store the base64-encoded certificate in a GitHub Secret:
```bash
base64 -w 0 popmyc-signing.p12 > cert_b64.txt
# Paste content of cert_b64.txt into GitHub Secret: WINDOWS_CERTIFICATE
```

### On a local build machine

```powershell
$env:CSC_LINK        = "C:\Secrets\popmyc-signing.p12"
$env:CSC_KEY_PASSWORD = "your-certificate-password"
.\scripts\build-desktop.ps1 -Package
```

## What NOT to do

- ❌ Never commit `.p12`, `.pfx`, or `.cer` files containing private keys
- ❌ Never hard-code the certificate password in source code
- ❌ Never store the certificate in the project directory
- ❌ Never use a self-signed certificate for distribution

## Verifying a signed build

After building with a valid certificate:
```powershell
# Check the signature on the produced .exe
Get-AuthenticodeSignature "desktop\dist-installer\POPMYC-POS-Setup-1.0.0.exe"
```

Expected output: `Status: Valid`, `SignerCertificate: POPMyC Solutions`

## electron-builder signing configuration

The `win.signingHashAlgorithms` is set to `["sha256"]` in `package.json`.
The `signDlls` is set to `false` to speed up signing (Electron DLLs
are already signed by Microsoft/Electron).

## Timestamp server

electron-builder automatically uses a timestamp server so the signature
remains valid after the certificate expires. No additional configuration
is needed.
