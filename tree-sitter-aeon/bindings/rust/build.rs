fn main() {
    let parser_path = std::path::Path::new("src").join("parser.c");
    if parser_path.exists() {
        cc::Build::new()
            .include("src")
            .file(parser_path)
            .compile("tree-sitter-aeon");
    } else {
        println!("cargo:warning=src/parser.c not found; run `tree-sitter generate` first");
    }
}
