function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)));
}

// Lexical editor subset only; the implementation owns address validation.
function sansaPrefix() {
  return seq(/[$?]/, repeat(choice(
    /\.(?:\\[A-Za-z0-9_-]+\\|[A-Za-z_][A-Za-z0-9_]*|\*{1,2}|@|\["(?:\\.|[^"\\])*"\]|<"(?:\\.|[^"\\])*">)|\[(?:0|[1-9][0-9]*)\]/,
    /&(?:key|tag)\("(?:\\[^\r\n]|[^"\\\r\n])*"\)/
  )));
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

    _item: ($) => choice($._comment, $.node_literal, $.binding),

    _comment: ($) => choice(
      $.line_doc_comment,
      $.line_annotation_comment,
      $.line_hint_comment,
      $.line_comment,
      $.block_doc_comment,
      $.block_annotation_comment,
      $.block_hint_comment,
      $.block_comment
    ),

    binding: ($) => seq(
      field('key', $._key),
      '=',
      field('value', $._assigned_value)
    ),

    _key: ($) => choice(
      $.identified_key,
      $.typed_key,
      $.annotated_key,
      $.directive_key,
      $._key_name
    ),

    identified_key: ($) => seq(
      field('name', $._key_name),
      field('identity', $.structural_identity),
      optional(field('attributes', $.attribute_map)),
      optional(seq(':', field('datatype', $.type_name), optional($.type_parameters)))
    ),

    structural_identity: () => token(/\\[A-Za-z0-9_-]+\\/),

    identified_value: ($) => seq(
      field('identity', $.structural_identity),
      optional(field('attributes', $.attribute_map)),
      optional(seq(':', field('datatype', $.type_name), optional($.type_parameters))),
      '=',
      field('value', $._assigned_value)
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
      repeat(seq(choice($._comment, $.attribute_assignment, $.node_literal), optional(','))),
      '}'
    ),

    attribute_assignment: ($) => seq(
      field('key', choice($.attribute_key, $.quoted_key)),
      optional(field('identity', $.structural_identity)),
      optional(field('attributes', $.attribute_map)),
      optional(seq(':', field('datatype', $.type_name), optional($.type_parameters))),
      '=',
      field('value', $._assigned_value)
    ),

    attribute_key: () => token(/[A-Za-z_][A-Za-z0-9_-]*/),

    type_name: () => token(/[A-Za-z_][A-Za-z0-9_]*/),

    type_parameters: ($) => choice(
      seq('<', commaSep1($.type_parameter), '>', optional($._clarifier)),
      $._clarifier
    ),

    type_parameter: ($) => seq($.type_name, optional($.type_parameters)),

    _clarifier: ($) => seq('[', commaSep1(choice(
      $.quoted_key,
      $.float,
      $.number,
      $.boolean,
      $.switch_literal,
      $.identifier
    )), ']'),

    node_literal: ($) => seq(
      '<',
      field('tag', choice($.identifier, $.quoted_tag)),
      optional(field('identity', $.structural_identity)),
      optional(field('attributes', $.attribute_map)),
      optional(seq(
        ':',
        field('datatype', $.type_name),
        optional(field('parameters', $.type_parameters))
      )),
      optional(seq('(', optional($._positions), ')')),
      '>'
    ),

    quoted_tag: () => token(choice(
      seq('"', repeat1(choice(/[^"\\\r\n]+/, /\\./)), '"'),
      seq("'", repeat1(choice(/[^'\\\r\n]+/, /\\./)), "'")
    )),

    object: ($) => seq(
      '{',
      repeat(seq($._item, optional(','))),
      '}'
    ),

    list: ($) => seq('[', optional($._positions), ']'),

    tuple: ($) => seq('(', optional($._positions), ')'),

    _positions: ($) => repeat1(seq(choice($._value, $._comment), optional(','))),

    clone_reference: ($) => seq(
      '~',
      field('path', $.reference_path)
    ),

    pointer_reference: ($) => seq(
      '~>',
      field('path', $.reference_path)
    ),

    sansa_address: () => token(sansaPrefix()),

    // Recovery is explicit, not a claim that an unfinished address is valid.
    incomplete_sansa_address: () => token(seq(sansaPrefix(),
      /&(?:key|tag)\((?:"(?:\\[^\r\n]|[^"\\\r\n])*(?:\\|")?)?/
    )),

    reference_path: () => token(/\$?(?:\.?[A-Za-z_][A-Za-z0-9_]*|\[\d+\]|\["(?:\\.|[^"])*"\]|\.@(?:\.[A-Za-z_][A-Za-z0-9_]*|\.\["(?:\\.|[^"])*"\]))+/),

    _value: ($) => choice($.node_literal, $.identified_value, $._assigned_value),

    _assigned_value: ($) => choice(
      $.object,
      $.list,
      $.tuple,
      $.clone_reference,
      $.pointer_reference,
      $.string,
      $.template_string,
      $.hex_literal,
      $.radix_literal,
      $.sansa_address,
      $.incomplete_sansa_address,
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
    local_datetime: () => token(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:&local)?/),
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
