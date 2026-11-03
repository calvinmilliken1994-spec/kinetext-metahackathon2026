# Brand assets

- `social-preview.png`: the GitHub social preview card, 1280 × 640. Upload it in the repository's
  **Settings → General → Social preview → Edit → Upload an image**.
- `social-preview.html`: its source. Everything sits inside an 80 px inset (GitHub's 40 pt guide at 2×); open it
  with `?guide` to see that safe area. Colours and type are the app's own dark-theme tokens.

Re-render the card after editing the HTML (Windows, from this folder):

```bash
"C:/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --hide-scrollbars \
  --force-device-scale-factor=1 --window-size=1280,640 \
  --screenshot="$(pwd -W)/social-preview.png" "file:///$(pwd -W)/social-preview.html"
```

No Meta logo is used: Meta's brand guidelines require approval for any use of it.
