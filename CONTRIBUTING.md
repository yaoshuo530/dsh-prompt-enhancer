# Contributing

Thanks for your interest in this plugin! Issues and improvements are welcome.

## How to contribute

- **Bug reports / feature requests**: open an issue with a short description
  and, for bugs, the steps to reproduce.
- **Pull requests**: keep the change focused, add a short description, and
  make sure the syntax check passes:
  ```sh
  npm run check
  ```

## Repository layout

| Path | Description |
| ---- | ----------- |
| `lib/index.js` | Host half — `POST /__dsh-enhance/api` JSON RPC (`prepare` / `complete`), context assembly and `llm.stream` |
| `lib/client.js` | Client half — ModuleLoader browser plugin: composer button (`conversation.input.right`) and overlay cards (`shell.overlay`) |
| `cordis.patch.yml` | Plugin install manifest for `dsh` |

## Notes

- UI strings are currently Chinese; keep them in the plugin code.
- The plugin preserves the user's input language for enhanced output.
