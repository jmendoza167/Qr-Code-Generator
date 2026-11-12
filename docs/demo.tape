# VHS tape for the README demo (https://github.com/charmbracelet/vhs).
# Regenerate the GIF with:  npm run demo
#
# Privacy: everything between Hide and Show is executed but not recorded.
# The hidden setup replaces the prompt (which would show the user name and
# folder), moves into an empty temporary directory and clears the screen,
# so no path, user name or real data appears in any frame. The hidden
# section at the end deletes the temporary directory again.

Output docs/demo.gif

Set Shell "powershell"
Set FontSize 18
Set Width 1040
Set Height 920
Set Padding 16
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Set Framerate 20

# ---- hidden setup ---------------------------------------------------------
Hide
Type `function prompt { "> " }`
Enter
Type `$demo = Join-Path ([IO.Path]::GetTempPath()) ("qrgen-demo-" + [guid]::NewGuid().ToString("N")); New-Item -ItemType Directory $demo | Out-Null; Set-Location $demo`
Enter
Sleep 1s
Type "Clear-Host"
Enter
Sleep 500ms
Show

# ---- 1. a QR code in the terminal ------------------------------------------
Type 'qrgen "https://github.com/jmendoza167/Qr-Code-Generator"'
Sleep 300ms
Enter
Sleep 3s

Hide
Type "Clear-Host"
Enter
Show

# ---- 2. the same with --info -----------------------------------------------
Type 'qrgen "https://github.com/jmendoza167/Qr-Code-Generator" --info'
Sleep 300ms
Enter
Sleep 2.5s

Hide
Type "Clear-Host"
Enter
Show

# ---- 3. a styled PNG -------------------------------------------------------
Type 'qrgen "https://github.com/jmendoza167/Qr-Code-Generator" -o styled.png --shape dots --finder circle --gradient "#1a237e,#00897b"'
Sleep 300ms
Enter
Sleep 2s

# ---- 4. Wi-Fi preset with the hidden password prompt -----------------------
Type 'qrgen wifi --ssid "CoffeeShop-Guest"'
Sleep 300ms
Enter
Sleep 1s
# Typed, but nothing is echoed. Fake password, fake network.
Type "not-a-real-password"
Sleep 800ms
Enter
Sleep 3s

# ---- hidden cleanup --------------------------------------------------------
Hide
Type `Set-Location ([IO.Path]::GetTempPath()); Remove-Item -Recurse -Force $demo`
Enter
Sleep 500ms
Show
