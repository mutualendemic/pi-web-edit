# PI WEB CodeMirror Editor plugin

Adds a manual **Edit** preview to PI WEB's existing **Files** panel. Choose **Edit** for a supported text file to edit and save it in the current workspace using CodeMirror 6, an open-source editor published under the MIT license. The editor code loads only when **Edit** is selected. Editing and saving stay in the browser/workspace transport; file contents are not sent to an editor service.

The preview is limited to non-binary, non-truncated files up to 2 MiB. It includes syntax support for JavaScript/TypeScript, JSON, CSS, HTML, Python, Markdown, YAML, SQL, Rust, XML, C/C++, Java, and Go. Before saving, the plugin checks whether the file's modification time changed since it was opened and asks for an explicit **Overwrite** action when it detects a conflict. That check is advisory (the host write API does not provide an atomic compare-and-swap).

## Install from npm

After publication, install `@mutualendemic/pi-web-codemirror-editor` through **Settings → Pi packages**. Then enable **CodeMirror Editor** in **Settings → PI WEB plugins** and reload the browser. The plugin is browser-only; no session-daemon restart is required.

## Build and install locally

```sh
npm install
npm run build
mkdir -p "${PI_WEB_DATA_DIR:-$HOME/.pi-web}/plugins"
ln -s "$PWD" "${PI_WEB_DATA_DIR:-$HOME/.pi-web}/plugins/codemirror-editor"
```

Enable **CodeMirror Editor** in **Settings → PI WEB plugins**, then reload the browser. This is a browser-only plugin; rebuilding or changing it does not require a session-daemon restart. The PI WEB host must support browser plugin API v5 and the `stylesheet-integration` v1 capability.

For local development, rebuild after source changes and reload the browser. The package's `dist/browser` directory is the only public asset root; do not put secrets there.
