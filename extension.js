const vscode = require("vscode");
const cp = require("child_process");
const path = require("path");

/* ------------------- ACTIVATE FUNCTION ------------------- */
function activate(context) {
    console.log("BugBuddy Activated");

    const provider = new ErrorRankProvider(context.extensionUri);

    // Register sidebar webview
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("bugbuddy.errorRankView", provider)
    );

    // Update UI when diagnostics change
    context.subscriptions.push(
        vscode.languages.onDidChangeDiagnostics(() => provider.updateRank())
    );
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => provider.updateRank())
    );

    // Hover explanations
    registerHoverProvider(context);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand("bugbuddy.openTerminal", () =>
            openBugBuddyTerminal(context)
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("bugbuddy.runFile", () =>
            runActiveFileInFriendlyTerminal(context)
        )
    );

    provider.updateRank(); // initial update
}

/* ------------------- SIDEBAR VIEW PROVIDER ------------------- */
class ErrorRankProvider {
    constructor(extensionUri) {
        this.extensionUri = extensionUri;
        this.view = null;
    }

    resolveWebviewView(webviewView) {
        this.view = webviewView.webview;

        this.view.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.extensionUri, "images")
            ]
        };

        this.view.html = this.getHtml(this.view);
        this.updateRank();
    }

    updateRank() {
        if (!this.view) return;

        const editor = vscode.window.activeTextEditor;
        let count = -1;

        if (editor) {
            const diags = vscode.languages.getDiagnostics(editor.document.uri);
            count = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Error).length;
        }

        this.view.postMessage({ command: "update", count });
    }

    getHtml(webview) {
        const A = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "images", "image_A.svg"));
        const B = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "images", "image_B.svg"));
        const C = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "images", "image_C.svg"));
        const IDLE = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "images", "idle.svg"));

        const nonce = getNonce();

        return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {
                    background: #df0d0dff;
                    color: white;
                    font-family: sans-serif;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    flex-direction: column;
                    height: 100vh;
                    margin: 0;
                }
                img {
                    width: 150px;
                    margin-bottom: 10px;
                }
                #simple {
                    color: #ccc;
                    font-size: 13px;
                }
            </style>
        </head>

        <body>
            <h3>Error Rank</h3>

            <img id="img" src="${IDLE}">
            <p id="simple">Waiting...</p>

            <script nonce="${nonce}">
                const PATHS = { A: "${A}", B: "${B}", C: "${C}", IDLE: "${IDLE}" };

                window.addEventListener("message", (e) => {
                    const count = e.data.count;
                    let src = PATHS.IDLE;
                    let txt = "Open a file to see errors.";

                    if (count >= 0) {
                        if (count <= 3) src = PATHS.A;
                        else if (count <= 7) src = PATHS.B;
                        else src = PATHS.C;

                        txt = count + " error(s).";
                    }

                    document.getElementById("img").src = src;
                    document.getElementById("simple").innerText = txt;
                });
            </script>
        </body>
        </html>`;
    }
}

/* ------------------- HOVER EXPLANATIONS ------------------- */
function registerHoverProvider(context) {
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(["javascript", "python", "c"], {
            provideHover(document, position) {
                const diagnostics = vscode.languages.getDiagnostics(document.uri);

                const diag = diagnostics.find(
                    d =>
                        d.severity === vscode.DiagnosticSeverity.Error &&
                        d.range.contains(position)
                );

                if (!diag) return;

                const explanation = simplifyError(diag.message);

                return new vscode.Hover(
                    new vscode.MarkdownString(`💡 **BugBuddy says:**\n\n${explanation}`)
                );
            }
        })
    );
}

function simplifyError(msg) {
    msg = msg.toLowerCase();

    if (msg.includes("unexpected token")) return "You probably missed a character like ';' or ')'.";
    if (msg.includes("undefined")) return "You're using a variable before defining it.";
    if (msg.includes("not defined")) return "This variable does not exist.";
    if (msg.includes("syntax")) return "You have a syntax error.";

    return "Check your variables or syntax.";
}

/* ------------------- FRIENDLY TERMINAL ------------------- */
let term;

function openBugBuddyTerminal(context) {
    if (!term) {
        term = vscode.window.createTerminal("BugBuddy Terminal");
        context.subscriptions.push(term);
    }

    term.show();
    term.sendText("🐞 BugBuddy Terminal Ready!\n");
}

function runActiveFileInFriendlyTerminal(context) {
    if (!term) openBugBuddyTerminal(context);

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        term.sendText("❌ No file open.\n");
        return;
    }

    const file = editor.document.fileName;
    const ext = path.extname(file);

    let cmd = null;

    if (ext === ".js") cmd = `node "${file}"`;
    else if (ext === ".py") cmd = `python "${file}"`;
    else if (ext === ".c") cmd = `gcc "${file}" -o output && ./output"`;
    else {
        term.sendText("❌ File type not supported.\n");
        return;
    }

    term.sendText(`> Running: ${cmd}\n\n`);

    cp.exec(cmd, (err, stdout, stderr) => {
        if (stdout) term.sendText("OUTPUT:\n" + stdout);
        if (stderr) term.sendText("ERROR:\n" + stderr);
        if (err) term.sendText("RUNTIME ERROR:\n" + err.message);
    });
}

/* ------------------- UTIL ------------------- */
function getNonce() {
    let text = "";
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}

function deactivate() {}

module.exports = { activate, deactivate };
    