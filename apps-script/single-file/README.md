# Single-file build

`Code.gs` here is all seven `../*.gs` files concatenated, for pasting into one
Apps Script file. Regenerate after editing the sources:

```bash
(cd apps-script && { for f in Config Auth Sheet Compliance Email Telegram Code; do
  printf '\n// %s\n// %s\n\n' "$(printf '=%.0s' {1..70})" "$f"; cat "$f.gs"; done; } > build/Code.gs)
```
