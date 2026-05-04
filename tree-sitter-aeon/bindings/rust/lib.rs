//! Rust bindings for tree-sitter-aeon.
//!
//! This file assumes `tree-sitter generate` has produced `src/parser.c`.

use tree_sitter_language::LanguageFn;

extern "C" {
    fn tree_sitter_aeon() -> *const ();
}

/// Returns the Tree-sitter language for AEON.
pub fn language() -> LanguageFn {
    unsafe { LanguageFn::from_raw(tree_sitter_aeon) }
}
