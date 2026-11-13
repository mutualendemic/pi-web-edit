import type {
  FilePreviewerInput,
  PiWebPlugin,
  PluginCapability,
  StylesheetIntegrationCapabilityV1,
} from "@jmfederico/pi-web/plugin-api";

const MAX_FILE_SIZE = 2 * 1024 * 1024;
const EDITOR_ELEMENT_NAME = "pi-web-codemirror-file-editor";
const LOADER_ELEMENT_NAME = "pi-web-codemirror-file-editor-loader";

type EditorInput = FilePreviewerInput;
type WorkspaceFile = EditorInput["file"];
type WorkspaceFiles = EditorInput["files"];

interface CodeMirrorEditorElement extends HTMLElement {
  file: WorkspaceFile;
  files: WorkspaceFiles;
  signal: AbortSignal;
  stylesheetIntegration: StylesheetIntegrationCapabilityV1 | undefined;
}

const stylesheetIntegration: PluginCapability<StylesheetIntegrationCapabilityV1> = {
  pluginId: "pi-web",
  id: "stylesheet-integration",
  version: 1,
  parse(value) {
    if (typeof value !== "object" || value === null
      || !("registerRoot" in value) || typeof value.registerRoot !== "function"
      || !("createController" in value) || typeof value.createController !== "function"
      || !("subscribe" in value) || typeof value.subscribe !== "function") {
      throw new Error("CodeMirror Editor requires stylesheet integration v1");
    }
    return value as StylesheetIntegrationCapabilityV1;
  },
};

class CodeMirrorEditorLoader extends HTMLElement {
  private currentFile: WorkspaceFile | undefined;
  private currentFiles: WorkspaceFiles | undefined;
  private currentSignal: AbortSignal | undefined;
  private styles: StylesheetIntegrationCapabilityV1 | undefined;
  private editorElement: CodeMirrorEditorElement | undefined;
  private moduleLoaded = false;
  private loading = false;

  constructor() {
    super();
    this.style.display = "block";
    this.style.width = "100%";
  }

  set file(value: WorkspaceFile) {
    this.currentFile = value;
    this.syncEditor();
  }

  set files(value: WorkspaceFiles) {
    this.currentFiles = value;
    this.syncEditor();
  }

  set signal(value: AbortSignal) {
    this.currentSignal = value;
    this.syncEditor();
  }

  set stylesheetIntegration(value: StylesheetIntegrationCapabilityV1 | undefined) {
    this.styles = value;
    this.syncEditor();
  }

  connectedCallback(): void {
    if (this.moduleLoaded) this.mountEditor();
    else void this.loadEditorModule();
  }

  private async loadEditorModule(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.textContent = "Loading CodeMirror…";
    try {
      await import("./CodeMirrorFileEditor");
      this.moduleLoaded = true;
      if (this.isConnected) this.mountEditor();
    } catch (error) {
      console.error("CodeMirror Editor preview failed to load", error);
      if (this.isConnected) {
        const detail = error instanceof Error ? ` ${error.message}` : "";
        this.textContent = `CodeMirror could not load.${detail}`;
        this.setAttribute("role", "alert");
      }
    } finally {
      this.loading = false;
    }
  }

  private syncEditor(): void {
    if (this.editorElement) this.applyInputs(this.editorElement);
  }

  private mountEditor(): void {
    if (!this.isConnected || !this.currentFile || !this.currentFiles || !this.currentSignal) return;
    if (!this.editorElement) {
      this.editorElement = document.createElement(EDITOR_ELEMENT_NAME) as CodeMirrorEditorElement;
      this.replaceChildren(this.editorElement);
    }
    this.applyInputs(this.editorElement);
  }

  private applyInputs(editor: CodeMirrorEditorElement): void {
    if (!this.currentFile || !this.currentFiles || !this.currentSignal) return;
    editor.file = this.currentFile;
    editor.files = this.currentFiles;
    editor.signal = this.currentSignal;
    editor.stylesheetIntegration = this.styles;
  }
}

if (!customElements.get(LOADER_ELEMENT_NAME)) {
  customElements.define(LOADER_ELEMENT_NAME, CodeMirrorEditorLoader);
}

export default {
  apiVersion: 5,
  name: "CodeMirror Editor",
  requires: [stylesheetIntegration],
  activate({ html }) {
    let styles: StylesheetIntegrationCapabilityV1 | undefined;
    return {
      start({ capabilities }) {
        styles = capabilities.resolve(stylesheetIntegration);
      },
      contributions: {
        filePreviewers: [{
          id: "edit",
          title: "Edit",
          renderMode: "manual",
          supports: ({ file }) => !file.binary && !file.truncated && file.size <= MAX_FILE_SIZE,
          render({ file, files, signal }: EditorInput) {
            return html`<pi-web-codemirror-file-editor-loader
              .file=${file}
              .files=${files}
              .signal=${signal}
              .stylesheetIntegration=${styles}
            ></pi-web-codemirror-file-editor-loader>`;
          },
        }],
      },
    };
  },
} satisfies PiWebPlugin;
