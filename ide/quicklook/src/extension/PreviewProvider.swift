import Foundation
import QuickLookUI
import UniformTypeIdentifiers
import JavaScriptCore

@objc(AEONPreviewProvider)
public class AEONPreviewProvider: NSObject, QLPreviewingController {

    private static let jsContext: JSContext? = {
        guard let ctx = JSContext() else { return nil }
        ctx.exceptionHandler = { _, exception in
            NSLog("[AEONQuickLook] JS error: %@", exception?.toString() ?? "unknown")
        }

        // Try loading from bundled resource
        let bundle = Bundle(for: AEONPreviewProvider.self)
        if let scriptUrl = bundle.url(forResource: "highlighter", withExtension: "js"),
           let script = try? String(contentsOf: scriptUrl, encoding: .utf8) {
            ctx.evaluateScript(script)
            return ctx
        }

        // Fallback embedded script
        let fallback = """
        function escapeHtml(v) {
          return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
        function highlightAeon(src) {
          return src.split('\\n').map(function(l) { return escapeHtml(l); }).join('\\n');
        }
        function highlightAnd(src) {
          return src.split('\\n').map(function(l) { return escapeHtml(l); }).join('\\n');
        }
        """
        ctx.evaluateScript(fallback)
        return ctx
    }()

    @objc(providePreviewForFileRequest:completionHandler:)
    public func providePreview(for request: QLFilePreviewRequest, completionHandler: @escaping (QLPreviewReply?, (any Error)?) -> Void) {
        let fileURL = request.fileURL
        let fileName = fileURL.lastPathComponent
        let fileExt = fileURL.pathExtension.lowercased()

        let rawContent: String
        do {
            if let str = try? String(contentsOf: fileURL, encoding: .utf8) {
                rawContent = str
            } else if let str = try? String(contentsOf: fileURL, encoding: .isoLatin1) {
                rawContent = str
            } else {
                rawContent = try String(contentsOf: fileURL, encoding: .ascii)
            }
        } catch {
            completionHandler(nil, error)
            return
        }

        let highlightedHtml = Self.highlight(source: rawContent, ext: fileExt)
        let totalLines = rawContent.components(separatedBy: "\n").count
        let formattedSize = Self.formatFileSize(url: fileURL)
        let badge = fileExt == "and" ? "&amp;ND" : "AEON"

        let fullHtml = Self.buildPage(
            fileName: fileName,
            badge: badge,
            totalLines: totalLines,
            fileSize: formattedSize,
            highlightedHtml: highlightedHtml
        )

        let reply = QLPreviewReply(dataOfContentType: .html, contentSize: CGSize(width: 840, height: 600)) { _ in
            return fullHtml.data(using: .utf8) ?? Data()
        }

        completionHandler(reply, nil)
    }

    private static func highlight(source: String, ext: String) -> String {
        guard let ctx = jsContext else {
            return escapeHtml(source)
        }

        let fnName = (ext == "and") ? "highlightAnd" : "highlightAeon"
        guard let fn = ctx.objectForKeyedSubscript(fnName), !fn.isUndefined else {
            return escapeHtml(source)
        }

        let result = fn.call(withArguments: [source])
        return result?.toString() ?? escapeHtml(source)
    }

    private static func escapeHtml(_ text: String) -> String {
        return text
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }

    private static func formatFileSize(url: URL) -> String {
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
              let size = attrs[.size] as? Int64 else {
            return ""
        }
        let bcf = ByteCountFormatter()
        bcf.allowedUnits = [.useAll]
        bcf.countStyle = .file
        return bcf.string(fromByteCount: size)
    }

    private static func buildPage(
        fileName: String,
        badge: String,
        totalLines: Int,
        fileSize: String,
        highlightedHtml: String
    ) -> String {
        let lines = highlightedHtml.components(separatedBy: "\n")
        var tableRows = ""
        tableRows.reserveCapacity(lines.count * 128)

        for (idx, lineHtml) in lines.enumerated() {
            let lineNum = idx + 1
            let content = lineHtml.isEmpty ? "&nbsp;" : lineHtml
            tableRows += "<tr><td class=\"ln\">\(lineNum)</td><td class=\"code\">\(content)</td></tr>"
        }

        return """
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>\(escapeHtml(fileName))</title>
          <style>
            :root {
              --aeon-bg: #111827;
              --aeon-panel: #172131;
              --aeon-border: #233247;
              --aeon-fg: #e5e7eb;
              --aeon-muted: #9aa6b2;
              --aeon-ln: #4b5563;
              --aeon-ln-border: #1f293d;
              --aeon-key: #7fb2ff;
              --aeon-type: #c7b8ff;
              --aeon-attribute: #caa0bf;
              --aeon-attribute-punct: #d8b070;
              --aeon-tag: #e2c97a;
              --aeon-string: #d9c58b;
              --aeon-literal: #c7d98a;
              --aeon-directive: #8ec7d9;
              --aeon-comment: #a8adb8;
              --aeon-comment-doc: #9aa9c7;
              --aeon-comment-annotation: #7fc7d4;
              --aeon-comment-hint: #d9ad7c;
              --aeon-comment-host: #a7b2c4;
              --aeon-punct: #8d96a6;
              --header-bg: rgba(23, 33, 49, 0.94);
              --badge-bg: rgba(127, 178, 255, 0.15);
              --badge-fg: #7fb2ff;
            }

            @media (prefers-color-scheme: light) {
              :root {
                --aeon-bg: #f8fafc;
                --aeon-panel: #ffffff;
                --aeon-border: #e2e8f0;
                --aeon-fg: #1e293b;
                --aeon-muted: #64748b;
                --aeon-ln: #94a3b8;
                --aeon-ln-border: #f1f5f9;
                --aeon-key: #2563eb;
                --aeon-type: #7c3aed;
                --aeon-attribute: #9333ea;
                --aeon-attribute-punct: #b45309;
                --aeon-tag: #b45309;
                --aeon-string: #a16207;
                --aeon-literal: #15803d;
                --aeon-directive: #0284c7;
                --aeon-comment: #64748b;
                --aeon-comment-doc: #475569;
                --aeon-comment-annotation: #0e7490;
                --aeon-comment-hint: #c2410c;
                --aeon-comment-host: #475569;
                --aeon-punct: #64748b;
                --header-bg: rgba(255, 255, 255, 0.94);
                --badge-bg: rgba(37, 99, 235, 0.1);
                --badge-fg: #2563eb;
              }
            }

            * {
              box-sizing: border-box;
            }

            html, body {
              margin: 0;
              padding: 0;
              background-color: var(--aeon-bg);
              color: var(--aeon-fg);
              font-family: "SF Mono", Monaco, Menlo, Consolas, monospace;
              font-size: 13px;
              line-height: 1.6;
              height: 100%;
              -webkit-font-smoothing: antialiased;
            }

            .header {
              position: sticky;
              top: 0;
              z-index: 10;
              display: flex;
              align-items: center;
              justify-content: space-between;
              padding: 10px 18px;
              background: var(--header-bg);
              backdrop-filter: blur(12px);
              -webkit-backdrop-filter: blur(12px);
              border-bottom: 1px solid var(--aeon-border);
            }

            .header-left {
              display: flex;
              align-items: center;
              gap: 10px;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
              font-size: 13px;
              font-weight: 600;
              color: var(--aeon-fg);
            }

            .badge {
              display: inline-block;
              padding: 2px 8px;
              font-size: 11px;
              font-weight: 700;
              letter-spacing: 0.05em;
              text-transform: uppercase;
              border-radius: 4px;
              background: var(--badge-bg);
              color: var(--badge-fg);
            }

            .header-meta {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
              font-size: 11px;
              color: var(--aeon-muted);
            }

            .code-container {
              padding: 12px 0 24px;
              overflow-x: auto;
            }

            table {
              border-collapse: collapse;
              width: 100%;
            }

            tr:hover {
              background: rgba(127, 178, 255, 0.04);
            }

            td.ln {
              width: 48px;
              min-width: 48px;
              padding: 0 14px 0 16px;
              text-align: right;
              user-select: none;
              -webkit-user-select: none;
              color: var(--aeon-ln);
              border-right: 1px solid var(--aeon-ln-border);
              vertical-align: top;
            }

            td.code {
              padding: 0 16px;
              white-space: pre;
              vertical-align: top;
            }

            /* AEON Token Highlighting */
            .tok-comment { color: var(--aeon-comment); font-style: italic; }
            .tok-comment-doc { color: var(--aeon-comment-doc); }
            .tok-comment-annotation { color: var(--aeon-comment-annotation); font-style: italic; }
            .tok-comment-hint { color: var(--aeon-comment-hint); }
            .tok-comment-host { color: var(--aeon-comment-host); }
            .tok-directive { color: var(--aeon-directive); font-weight: 600; }
            .tok-key { color: var(--aeon-key); }
            .tok-typed-key { color: var(--aeon-key); }
            .tok-typed-value { color: var(--aeon-type); }
            .tok-attribute-key { color: var(--aeon-attribute); }
            .tok-attribute-punct { color: var(--aeon-attribute-punct); }
            .tok-tag { color: var(--aeon-tag); font-weight: 700; }
            .tok-tag-punct, .tok-punct { color: var(--aeon-punct); }
            .tok-string, .tok-trimtick-string { color: var(--aeon-string); }
            .tok-literal { color: var(--aeon-literal); }
            .tok-binding { color: var(--aeon-key); }
            .tok-operator { color: var(--aeon-fg); }

            /* &ND Markup Highlighting */
            .tok-and-header { color: var(--aeon-tag); font-weight: 700; }
            .tok-and-version { color: var(--aeon-type); }
            .tok-and-heading { color: var(--aeon-key); font-weight: 700; }
            .tok-and-heading-marker { color: var(--aeon-muted); font-weight: 700; }
            .tok-and-fence { color: var(--aeon-punct); }
            .tok-and-fence-label { color: var(--aeon-directive); }
            .tok-and-extension-fence { color: var(--aeon-punct); }
            .tok-and-extension-name { color: var(--aeon-tag); }
            .tok-and-strong { font-weight: 700; color: var(--aeon-fg); }
            .tok-and-emphasis { font-style: italic; }
            .tok-and-code { color: var(--aeon-string); background: rgba(127, 178, 255, 0.08); padding: 1px 4px; border-radius: 3px; }
            .tok-and-link { color: var(--aeon-key); text-decoration: underline; }
            .tok-and-link-separator { color: var(--aeon-muted); }
            .tok-and-link-target { color: var(--aeon-muted); }
            .tok-and-list-marker { color: var(--aeon-tag); font-weight: 600; }
            .tok-and-list-text { color: var(--aeon-fg); }
            .tok-and-quote { color: var(--aeon-muted); }
            .tok-and-quote-text { color: var(--aeon-muted); font-style: italic; }
            .tok-and-table-pipe { color: var(--aeon-punct); font-weight: 700; }
            .tok-and-rule { color: var(--aeon-border); font-weight: 700; }
            .tok-and-escape { color: var(--aeon-attribute-punct); }
            .tok-and-invalid { color: #ef4444; text-decoration: wavy underline #ef4444; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="header-left">
              <span class="badge">\(badge)</span>
              <span>\(escapeHtml(fileName))</span>
            </div>
            <div class="header-meta">
              <span>\(totalLines) lines</span>
              \(fileSize.isEmpty ? "" : " &bull; <span>\(fileSize)</span>")
            </div>
          </div>
          <div class="code-container">
            <table>
              <tbody>
                \(tableRows)
              </tbody>
            </table>
          </div>
        </body>
        </html>
        """
    }
}
