function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)));
}

module.exports = grammar({
  name: 'aeon',

  extras: ($) => [
    /[ \t\r\n]+/
  ],

  supertypes: ($) => [
    $._item,
    $._key,
    $._key_name,
    $._value
  ],

  rules: {
    source_file: ($) => repeat($._item),

    _item: ($) => choice(
      $.line_doc_comment,
      $.line_annotation_comment,
      $.line_hint_comment,
      $.line_comment,
      $.block_doc_comment,
      $.block_annotation_comment,
      $.block_hint_comment,
      $.block_comment,
      $.node_literal,
      $.binding
    ),

    binding: ($) => seq(
      field('key', $._key),
      '=',
      field('value', $._value)
    ),

    _key: ($) => choice(
      $.typed_key,
      $.annotated_key,
      $.directive_key,
      $._key_name
    ),

    typed_key: ($) => seq(
      field('name', $._key_name),
      ':',
      field('datatype', $.type_name),
      optional(field('parameters', $.type_parameters))
    ),

    annotated_key: ($) => seq(
      field('name', $._key_name),
      field('attributes', $.attribute_map),
      optional(seq(
        ':',
        field('datatype', $.type_name),
        optional(field('parameters', $.type_parameters))
      ))
    ),

    directive_key: ($) => seq(
      'aeon',
      ':',
      field('name', $.identifier)
    ),

    _key_name: ($) => choice(
      $.identifier,
      $.quoted_key
    ),

    attribute_map: ($) => seq(
      '@',
      '{',
      optional(commaSep1($.attribute_assignment)),
      '}'
    ),

    attribute_assignment: ($) => seq(
      field('key', $.attribute_key),
      '=',
      field('value', $._value)
    ),

    attribute_key: () => token(/[A-Za-z_][A-Za-z0-9_:-]*/),

    type_name: () => token(/[A-Za-z_][A-Za-z0-9_]*/),

    type_parameters: ($) => choice(
      seq('<', commaSep1($.type_parameter), '>'),
      repeat1(seq('[', $.type_parameter, ']'))
    ),

    type_parameter: ($) => choice(
      $.type_name,
      $.number,
      $.identifier,
      $.quoted_key
    ),

    node_literal: ($) => seq(
      '<',
      field('tag', $.identifier),
      optional(field('attributes', $.attribute_map)),
      '(',
      repeat($._item),
      ')'
    ),

    object: ($) => seq(
      '{',
      repeat($._item),
      '}'
    ),

    list: ($) => seq(
      '[',
      repeat($._value),
      ']'
    ),

    tuple: ($) => seq(
      '(',
      repeat($._value),
      ')'
    ),

    clone_reference: ($) => seq(
      '~',
      field('path', $.reference_path)
    ),

    pointer_reference: ($) => seq(
      '~>',
      field('path', $.reference_path)
    ),

    reference_path: () => token(/\$?(?:\.?[A-Za-z_][A-Za-z0-9_]*|\[\d+\]|\["(?:\\.|[^"])*"\]|@\[[^\]]+\]|@[A-Za-z_][A-Za-z0-9_]*)+/),

    _value: ($) => choice(
      $.object,
      $.list,
      $.tuple,
      $.node_literal,
      $.clone_reference,
      $.pointer_reference,
      $.string,
      $.template_string,
      $.hex_literal,
      $.radix_literal,
      $.encoding_literal,
      $.separator_literal,
      $.zoned_datetime,
      $.utc_datetime,
      $.local_datetime,
      $.time_literal,
      $.date_literal,
      $.float,
      $.number,
      $.boolean,
      $.switch_literal,
      $.identifier
    ),

    quoted_key: () => token(choice(
      seq('"', repeat(choice(/[^"\\]+/, /\\./)), '"'),
      seq("'", repeat(choice(/[^'\\]+/, /\\./)), "'")
    )),

    string: () => token(choice(
      seq('"', repeat(choice(/[^"\\]+/, /\\./)), '"'),
      seq("'", repeat(choice(/[^'\\]+/, /\\./)), "'")
    )),

    template_string: () => token(seq('`', repeat(choice(/[^`\\]+/, /\\./)), '`')),

    hex_literal: () => token(seq('#', /[0-9A-Fa-f_]+/)),
    radix_literal: () => token(seq('%', /[A-Za-z0-9_]+/)),
    encoding_literal: () => token(seq('$', /[A-Za-z0-9+/=_-]+/)),
    separator_literal: () => token(seq('^', /[^\s,\]\)\}]+/)),

    zoned_datetime: () => token(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z&[A-Za-z0-9_./+-]+/),
    utc_datetime: () => token(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/),
    local_datetime: () => token(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:&Local)?/),
    time_literal: () => token(/\d{2}:\d{2}:\d{2}/),
    date_literal: () => token(/\d{4}-\d{2}-\d{2}/),

    float: () => token(/[+-]?\d[\d_]*\.\d[\d_]*(?:[eE][+-]?\d[\d_]*)?/),
    number: () => token(/[+-]?\d[\d_]*(?:[eE][+-]?\d[\d_]*)?/),
    boolean: () => token(choice('true', 'false')),
    switch_literal: () => token(choice('yes', 'no', 'on', 'off')),

    identifier: () => token(/[A-Za-z_][A-Za-z0-9_-]*/),

    line_doc_comment: () => token(/\/\/#.*/),
    line_annotation_comment: () => token(/\/\/@.*/),
    line_hint_comment: () => token(/\/\/\?.*/),
    line_comment: () => token(/\/\/.*/),

    block_doc_comment: () => token(prec(1, /\/#[\s\S]*?#\//)),
    block_annotation_comment: () => token(prec(1, /\/@[\s\S]*?@\//)),
    block_hint_comment: () => token(prec(1, /\/\?[\s\S]*?\?\//)),
    block_comment: () => token(prec(1, /\/\*[\s\S]*?\*\//))
  }
});
