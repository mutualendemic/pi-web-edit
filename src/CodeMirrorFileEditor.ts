import type { FilePreviewerInput, StylesheetIntegrationCapabilityV1 } from "@jmfederico/pi-web/plugin-api";
import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { basicSetup } from "codemirror";
import { Compartment, type Extension, EditorState, Prec } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";
import editorStyles from "./editor.css?inline";

type EditorInput = FilePreviewerInput;
type WorkspaceFile = EditorInput["file"];
type WorkspaceFiles = EditorInput["files"];

const ELEMENT_NAME = "pi-web-codemirror-file-editor";

class CodeMirrorFileEditor extends HTMLElement {
  private readonly root: ShadowRoot;
  private readonly themeCompartment = new Compartment();
  private readonly editableCompartment = new Compartment();
  private readonly toolbar: HTMLDivElement;
  private readonly editorHost: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly saveButton: HTMLButtonElement;
  private readonly discardButton: HTMLButtonElement;
  private readonly overwriteButton: HTMLButtonElement;
  private readonly filename: HTMLSpanElement;

  private currentFile: WorkspaceFile | undefined;
  private currentFiles: WorkspaceFiles | undefined;
  private currentSignal: AbortSignal | undefined;
  private styles: StylesheetIntegrationCapabilityV1 | undefined;
  private view: EditorView | undefined;
  private releaseStyles: (() => void) | undefined;
  private unsubscribeStyles: (() => void) | undefined;
  private sourceContent = "";
  private sourceModifiedAt = "";
  private editorGeneration = 0;
  private saving = false;
  private conflict = false;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
    const styleElement = document.createElement("style");
    styleElement.textContent = editorStyles;
    this.root.append(styleElement);

    const shell = document.createElement("section");
    shell.className = "editor-shell";

    this.toolbar = document.createElement("div");
    this.toolbar.className = "ui-toolbar editor-toolbar";

    const titleGroup = document.createElement("div");
    titleGroup.className = "ui-toolbar-group editor-title-group";
    this.filename = document.createElement("span");
    this.filename.className = "ui-toolbar-title editor-filename";
    titleGroup.append(this.filename);

    const actions = document.createElement("div");
    actions.className = "ui-toolbar-group ui-toolbar-group--bounded editor-actions";
    this.discardButton = this.createButton("Discard edits");
    this.discardButton.textContent = "Discard";
    this.discardButton.addEventListener("click", () => this.discardChanges());

    this.overwriteButton = this.createButton("Overwrite the file on disk");
    this.overwriteButton.textContent = "Overwrite";
    this.overwriteButton.hidden = true;
    this.overwriteButton.addEventListener("click", () => { void this.save(true); });

    this.saveButton = this.createButton("Save file");
    this.saveButton.textContent = "Save";
    this.saveButton.classList.add("ui-button--primary");
    this.saveButton.addEventListener("click", () => { void this.save(); });
    actions.append(this.discardButton, this.overwriteButton, this.saveButton);

    this.status = document.createElement("div");
    this.status.className = "editor-status";
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    this.toolbar.append(titleGroup, actions, this.status);

    this.editorHost = document.createElement("div");
    this.editorHost.className = "editor-host";
    this.editorHost.setAttribute("aria-label", "File editor");
    shell.append(this.toolbar, this.editorHost);
    this.root.append(shell);
  }

  set file(value: WorkspaceFile) {
    const changed = this.currentFile !== undefined
      && (this.currentFile.path !== value.path || this.currentFile.modifiedAt !== value.modifiedAt);
    this.currentFile = value;
    if (changed) this.disposeEditor();
    this.scheduleInitialize();
  }

  get file(): WorkspaceFile | undefined {
    return this.currentFile;
  }

  set files(value: WorkspaceFiles) {
    if (this.currentFiles !== undefined && this.currentFiles !== value) this.disposeEditor();
    this.currentFiles = value;
    this.scheduleInitialize();
  }

  get files(): WorkspaceFiles | undefined {
    return this.currentFiles;
  }

  set signal(value: AbortSignal) {
    if (this.currentSignal !== undefined && this.currentSignal !== value) this.disposeEditor();
    this.currentSignal = value;
    this.scheduleInitialize();
  }

  get signal(): AbortSignal | undefined {
    return this.currentSignal;
  }

  set stylesheetIntegration(value: StylesheetIntegrationCapabilityV1 | undefined) {
    if (this.styles === value) return;
    this.disconnectStyles();
    this.styles = value;
    if (this.isConnected) this.connectStyles();
  }

  get stylesheetIntegration(): StylesheetIntegrationCapabilityV1 | undefined {
    return this.styles;
  }

  connectedCallback(): void {
    this.connectStyles();
    this.scheduleInitialize();
  }

  disconnectedCallback(): void {
    this.disconnectStyles();
    this.disposeEditor();
  }

  private disposeEditor(): void {
    this.editorGeneration += 1;
    this.saving = false;
    this.conflict = false;
    this.currentSignal?.removeEventListener("abort", this.handleAbort);
    this.view?.destroy();
    this.view = undefined;
  }

  private createButton(label: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ui-button ui-button--compact";
    button.setAttribute("aria-label", label);
    return button;
  }

  private connectStyles(): void {
    if (!this.styles || !this.isConnected || this.releaseStyles) return;
    this.releaseStyles = this.styles.registerRoot(this.root, { sharedUi: true });
    this.unsubscribeStyles = this.styles.subscribe(() => this.updateTheme());
    this.updateTheme();
  }

  private disconnectStyles(): void {
    this.unsubscribeStyles?.();
    this.unsubscribeStyles = undefined;
    this.releaseStyles?.();
    this.releaseStyles = undefined;
  }

  private scheduleInitialize(): void {
    queueMicrotask(() => this.initialize());
  }

  private initialize(): void {
    if (!this.isConnected || this.view || !this.file || !this.files || !this.signal) return;
    if (this.signal.aborted) {
      this.setStatus("This file preview is no longer active.", true);
      return;
    }

    this.filename.textContent = this.file.path;
    this.filename.title = this.file.path;
    this.sourceContent = this.file.content;
    this.sourceModifiedAt = this.file.modifiedAt;
    this.editorHost.replaceChildren();
    this.setStatus("Saved", false);
    this.updateButtons(false);

    const extensions: Extension[] = [
      Prec.high(keymap.of([{
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          void this.save();
          return true;
        },
      }])),
      basicSetup,
      this.themeCompartment.of(this.createTheme()),
      this.editableCompartment.of(EditorView.editable.of(true)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) this.updateDirtyState();
      }),
    ];
    const language = this.resolveLanguage(this.file);
    if (language) extensions.push(language);

    const state = EditorState.create({ doc: this.file.content, extensions });
    this.view = new EditorView({ state, parent: this.editorHost, root: this.root });
    this.signal.addEventListener("abort", this.handleAbort, { once: true });
  }

  private readonly handleAbort = (): void => {
    this.view?.dispatch({ effects: this.editableCompartment.reconfigure(EditorView.editable.of(false)) });
    this.setStatus("This file preview is no longer active.", true);
  };

  private resolveLanguage(file: WorkspaceFile): Extension | undefined {
    const language = file.language?.toLowerCase() ?? "";
    const basename = file.path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
    const extension = basename.includes(".") ? basename.slice(basename.lastIndexOf(".")) : "";
    const typescript = ["typescript", "typescriptreact", "tsx"].includes(language)
      || [".ts", ".tsx"].includes(extension);
    const javascriptFile = ["javascript", "javascriptreact", "jsx"].includes(language)
      || [".js", ".jsx", ".mjs", ".cjs"].includes(extension);

    if (typescript || javascriptFile) {
      return javascript({ typescript, jsx: typescript ? extension === ".tsx" : extension === ".jsx" });
    }
    if (language === "json" || extension === ".json") return json();
    if (language === "css" || extension === ".css" || extension === ".scss" || extension === ".less") return css();
    if (language === "html" || extension === ".html" || extension === ".htm") return html();
    if (language === "python" || extension === ".py") return python();
    if (language === "markdown" || [".md", ".markdown"].includes(extension)) return markdown();
    if (language === "yaml" || [".yaml", ".yml"].includes(extension)) return yaml();
    if (language === "sql" || extension === ".sql") return sql();
    if (language === "rust" || extension === ".rs") return rust();
    if (language === "xml" || extension === ".xml" || extension === ".svg") return xml();
    if (language === "cpp" || [".c", ".h", ".cc", ".cpp", ".hpp"].includes(extension)) return cpp();
    if (language === "java" || extension === ".java") return java();
    if (language === "go" || extension === ".go") return go();
    return undefined;
  }

  private isDarkTheme(): boolean {
    const scheme = getComputedStyle(this).colorScheme.toLowerCase().split(/\s+/)[0];
    return scheme === "dark"
      || (scheme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  private createTheme(): Extension {
    const dark = this.isDarkTheme();
    const theme = EditorView.theme({
      "&": { height: "100%", fontSize: "14px" },
      ".cm-scroller, .cm-content": { fontFamily: "var(--pi-mono, monospace)" },
      ".cm-gutters": {
        backgroundColor: "var(--pi-bg, #fff)",
        color: "var(--pi-muted, #687482)",
        borderRight: "1px solid var(--pi-border, #d5dbe2)",
      },
      ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--pi-accent, #008c99) 8%, transparent)" },
    }, { dark });
    return dark ? [oneDark, theme] : theme;
  }

  private updateTheme(): void {
    if (!this.view) return;
    this.view.dispatch({ effects: this.themeCompartment.reconfigure(this.createTheme()) });
  }

  private updateDirtyState(): void {
    if (!this.view) return;
    const dirty = this.view.state.doc.toString() !== this.sourceContent;
    this.updateButtons(dirty);
    if (!this.saving && !this.conflict) this.setStatus(dirty ? "Unsaved changes" : "Saved", false);
  }

  private updateButtons(dirty: boolean): void {
    this.saveButton.disabled = !dirty || this.saving;
    this.discardButton.disabled = !dirty || this.saving;
    this.overwriteButton.hidden = !this.conflict;
    this.overwriteButton.disabled = this.saving;
  }

  private discardChanges(): void {
    if (!this.view || this.saving) return;
    this.conflict = false;
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: this.sourceContent } });
    this.updateDirtyState();
    this.setStatus("Edits discarded", false);
  }

  private async save(overwrite = false): Promise<void> {
    if (!this.view || !this.files || !this.file || this.saving || this.signal?.aborted) return;
    const view = this.view;
    const file = this.file;
    const files = this.files;
    const modifiedAt = this.sourceModifiedAt;
    const generation = this.editorGeneration;
    const content = view.state.doc.toString();
    if (content === this.sourceContent) return;

    this.saving = true;
    view.dispatch({ effects: this.editableCompartment.reconfigure(EditorView.editable.of(false)) });
    this.updateButtons(true);
    this.setStatus("Saving…", false);
    try {
      if (!overwrite) {
        const current = await files.readFile(file.path);
        if (generation !== this.editorGeneration) return;
        if (current.modifiedAt !== modifiedAt) {
          this.conflict = true;
          this.setStatus("The file changed on disk. Review your edits, then choose Overwrite or Discard.", true);
          this.updateButtons(true);
          return;
        }
      }

      const result = await files.writeFile(file.path, content);
      if (generation !== this.editorGeneration) return;
      this.sourceContent = content;
      this.sourceModifiedAt = result.modifiedAt;
      this.conflict = false;
      this.setStatus("Saved", false);
      view.focus();
    } catch (error) {
      if (generation === this.editorGeneration) {
        const detail = error instanceof Error ? error.message : String(error);
        this.setStatus(`Could not save: ${detail}`, true);
      }
    } finally {
      if (generation === this.editorGeneration) {
        this.saving = false;
        if (!this.currentSignal?.aborted) {
          view.dispatch({ effects: this.editableCompartment.reconfigure(EditorView.editable.of(true)) });
        }
        const dirty = this.view !== undefined && this.view.state.doc.toString() !== this.sourceContent;
        this.updateButtons(dirty);
      }
    }
  }

  private setStatus(message: string, isError: boolean): void {
    this.status.textContent = message;
    this.status.classList.toggle("editor-status--error", isError);
    this.status.setAttribute("role", isError ? "alert" : "status");
  }
}

if (!customElements.get(ELEMENT_NAME)) customElements.define(ELEMENT_NAME, CodeMirrorFileEditor);
