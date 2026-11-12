# Security policy

qrgen is a small, solo-maintained learning project. This page says how to
report a security problem and what you can expect in return.

## Supported versions

qrgen is pre-1.0. Only the latest release on the `main` branch receives
security fixes; older versions are not patched.

## Reporting a vulnerability

Please report security problems **privately** through GitHub's private
vulnerability reporting: open the **Security** tab of the repository and
click **Report a vulnerability**, or go straight to
<https://github.com/jmendoza167/Qr-Code-Generator/security/advisories/new>.

Do **not** open a public issue or pull request for a security problem.

A useful report includes:

- the affected version or commit,
- a description of the problem,
- steps or a proof-of-concept input to reproduce it (an SVG or PNG file, a
  command line, a payload string),
- the impact as you understand it.

## What to expect

This is a best-effort, one-person project, so timelines are honest rather
than ambitious:

- acknowledgement of your report within 7 days,
- an initial assessment within 14 days,
- coordinated disclosure: a fix and a published GitHub security advisory
  before details are made public.

If you would like to be credited in the advisory, say so in the report and
you will be.

## Scope

In scope:

- the QR encoder (`src/core/`),
- the PNG decoder used for logos,
- the SVG logo sanitizer and the way logos are embedded in SVG/PNG output,
- Wi-Fi and vCard payload escaping,
- CLI input handling: arguments, stdin, file paths and terminal output,
- the website, once it exists.

Out of scope:

- vulnerabilities in dev-only dependencies that never ship in the published
  package (the package has no runtime dependencies),
- the `-o` option overwriting an existing file: intentional, standard CLI
  behaviour,
- issues that require an already-compromised machine or account,
- social engineering and physical attacks.

## Existing defences

So you know what is already expected to hold: SVG logos are embedded as
images (data URIs) rather than inlined, so their markup never runs; the PNG
decoder caps dimensions before decompressing; and control characters in
payload fields are rejected or escaped. A report showing that one of these
does not hold is exactly what this policy is for.

## Safe harbour

Good-faith security research that follows this policy is welcome, and will
not be met with legal action from this project.
