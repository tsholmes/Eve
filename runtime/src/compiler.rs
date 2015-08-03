use std::collections::BitSet;
use std::cell::RefCell;
use std::convert::AsRef;
use std::mem::replace;

use value::Value;
use relation::{Relation, mapping, with_mapping};
use view::{View, Table, Join, Input, Source, Direction};
use flow::{Node, Flow};
use primitive;
use primitive::Primitive;

// schemas are arranged as (table name, fields)
// any field whose type is not described is a UUID

pub fn code_schema() -> Vec<(&'static str, Vec<&'static str>)> {
    vec![
    // all data lives in a view of some kind
    // `kind` is one of:
    // "table" - a view which can depend on the past
    // "join" - take the product of multiple views and filter the results
    // "union" - take the union of multiple views
    // "primitive" - a built-in function, represented as a view with one or more non-Data fields
    ("view", vec!["view", "kind"]),

    // views have fields
    // some fields have constraints on how they can be queried
    // `kind` is one of:
    // "output" - a normal field
    // "scalar input" - a field that must be constrained to a single scalar value
    // "vector input" - a field that must be constrained to a single vector value (in an aggregate)
    ("field", vec!["view", "field", "kind"]),

    // source ids have two purposes
    // a) uniquely generated ids to disambiguate multiple uses of the same view
    // (eg when joining a view with itself)
    // b) fixed ids to identify views which are used for some specific purpose
    // (these are "insert" and "remove" in tables)
    ("source", vec!["view", "source", "source view"]),

    // every view has a set of variables which are used to express constraints on the result of the view
    ("variable", vec!["view", "variable"]),

    // variables can be bound to constant values
    ("constant", vec!["variable", "value"]),

    // variables can be bound to fields
    ("binding", vec!["variable", "source", "field"]),

    // views produce output by binding fields from sources
    // each table or join field must be bound exactly once
    // each union field must be bound exactly once per source
    ("select", vec!["view", "field", "variable"]),

    // sources can be grouped by a subset of their fields
    // TODO primitive sources can't be grouped currently
    ("grouped field", vec!["view", "source", "field"]),

    // each group is then sorted by the reamining fields
    // `ix` is an ascending integer indicating the position of the field in the sort order
    // `direction` is one of "ascending" or "descending"
    // TODO how should we handle cases where some fields are neither grouped nor sorted?
    ("sorted field", vec!["view", "source", "ix", "field", "direction"]),

    // the ordinal is a virtual field that tracks the position of each row in the group
    // eg the first row has ordinal '1', the second row has ordinal '2' etc
    ("ordinal binding", vec!["variable", "source"]),

    // if a source is chunked, it will return each group as a whole rather than breaking them back down into rows
    ("chunked source", vec!["view", "source"]),

    // if a source is negated, the view fails whenever the source returns rows
    // every bound field of a negated source is treated as an input field
    ("negated source", vec!["view", "source"]),

    // tags are used to organise views
    ("tag", vec!["view", "tag"]),
    ]
}

pub fn compiler_schema() -> Vec<(&'static str, Vec<&'static str>)> {
    // the compiler reflects its decisions into some builtin tables
    // views marked "(pre)" are intermediate calculations

    vec![
    // a view dependency exists whenever the contents of one view depend directly on another
    ("view dependency (pre)", vec!["downstream view", "source", "upstream view"]),
    ("view dependency", vec!["downstream view", "ix", "source", "upstream view"]),

    // the view schedule determines what order views will be calculated in
    ("view schedule (pre)", vec!["view", "kind"]),
    ("view schedule", vec!["ix", "view", "kind"]),

    // a source 'provides' a variable if it can reduce thevariable to a finite number of values
    // a source 'requires' a variable if it needs the variable reduced to a finite number of values before it can contribute
    ("provides", vec!["view", "source", "variable"]),
    ("requires", vec!["view", "source", "variable"]),

    // the source schedule determines in which order the sources will be explored
    // the variable schedule determines whether a given variable is being assigned from a given source or constrained against it
    ("unscheduled source", vec!["view", "source"]),
    ("schedulable source", vec!["view", "source"]),
    ("unschedulable source", vec!["view", "source", "variable"]),
    ("source schedule (pre)", vec!["view", "pass", "source"]),
    ("source schedule", vec!["view", "ix", "pass", "source"]),
    ("variable schedule (pre)", vec!["view", "pass", "variable"]),
    ("variable schedule", vec!["view", "ix", "pass", "variable"]),

    // when a variable is bound to multiple fields from the same source we must arbitrarily decide to make
    // one an assignment and the others constraints
    ("constrained binding", vec!["variable", "source", "field"]),

    // index layout determines the order in which fields are stored in the view index
    ("compiler index layout", vec!["view", "ix", "field", "name"]),
    ("default index layout", vec!["view", "ix", "field", "kind"]),
    ("index layout", vec!["view", "field ix", "field", "name"]),

    // we need to know the number of fields per view to calculate the index of the ordinal
    ("number of fields", vec!["view", "num"]),

    // when a source has fields that are neither grouped nor sorted, we treat them as being sorted in id order
    ("non-sorted field (pre)", vec!["view", "source", "field"]),
    ("non-sorted field", vec!["view", "source", "ix", "field"]),

    // we denormalise all the above views so that the `create` function only needs to make a single pass over each table
    ("output layout", vec!["view ix", "field ix", "field", "name"]),
    ("number of variables (pre)", vec!["view", "num"]),
    ("number of variables", vec!["view ix", "num"]),
    ("constant layout", vec!["view ix", "variable ix", "value"]),
    ("source layout", vec!["view ix", "source ix", "input", "chunked", "negated"]),
    ("downstream layout", vec!["downstream view ix", "ix", "upstream view ix"]),
    ("binding layout", vec!["view ix", "source ix", "field ix", "variable ix", "kind"]),
    ("select layout", vec!["view ix", "ix", "variable ix"]),
    ("grouped field layout", vec!["view ix", "source ix", "field ix"]),
    ("sorted field layout", vec!["view ix", "source ix", "ix", "field ix", "direction"]),
    ("non-sorted field layout", vec!["view ix", "source ix", "ix", "field ix"]),
    ]
}

pub fn editor_schema() -> Vec<(&'static str, Vec<&'static str>)> {
    // the editor uses some tables to control the display of code and data

    vec![
    // things can have human readable names
    // `name` is a string
    ("display name", vec!["id", "name"]),

    // things can be displayed in ordered lists
    // `priority` is an f64. higher priority things are displayed first. ties are broken by id
    ("display order", vec!["id", "priority"]),

    // things which can be displayed in the sidebar
    // `type` is one of "table", "query", "ui"
    ("editor item", vec!["item", "type"]),

    // positions for nodes in the graphical editor
    ("editor node position", vec!["node", "x", "y"]),

    // descriptions for views in the editor
    ("view description", vec!["view", "description"]),

    // TODO what are this?
    ("primitive", vec!["view", "kind"]),
    ("block", vec!["query", "block", "view"]),
    ("block aggregate", vec!["view", "kind"]),
    ("calculated field", vec!["calculated field", "view", "source", "source view", "field"]),
    ("empty view", vec![]),
    ("query export", vec!["query", "view"]),
    ("source order", vec!["view", "source", "priority"]),

    // TODO what are this?
    ("uiComponentElement", vec!["tx", "id", "component", "layer", "control", "left", "top", "right", "bottom", "zindex"]),
    ("uiComponentLayer", vec!["tx", "id", "component", "layer", "locked", "hidden", "parentLayer"]),
    ("uiComponentAttribute", vec!["tx", "id", "property", "value"]),
    ("uiStyle", vec!["tx", "id", "type", "element", "shared"]),
    ("uiGroupBinding", vec!["group", "view"]),
    ("uiAttrBinding", vec!["elementId", "attr", "field"]),
    ("uiKeyCapture", vec!["elementId", "key"]),
    ("uiMap", vec!["tx", "map", "element"]),
    ("uiMapAttr", vec!["tx", "map", "property", "value"]),
    ("uiMapMarker", vec!["id", "map", "lat", "lng"]),
    ("geocoding request", vec!["formatted address"]),
    ("geocoding response status", vec!["formatted address","status"]),
    ("geocoding response data", vec!["formatted address","lat","lng"]),
    ]
}

pub fn client_schema() -> Vec<(&'static str, Vec<&'static str>)> {
    // clients store their local state (ui events, session data etc)

    vec![
    // TODO what are this?
    ("click", vec!["event number", "button", "binding"]),
    ("client event", vec!["session", "eventId", "type", "element", "row"]),
    ("mouse position", vec!["session", "eventId", "x", "y"]),
    ("text input", vec!["session", "eventId", "element", "binding", "value"]),
    ("location", vec!["session", "latitude", "longitude", "accuracy", "timestamp", "city"]),
    ("session url", vec!["session", "eventId", "href", "origin", "path", "hash"]),
    ("eveusers", vec!["id", "username"]),
    ("sessions", vec!["id", "status"]),
    ("session id to user id", vec!["session id", "user id"]),
    ("captured key", vec!["session", "eventId", "element", "key", "binding"]),
    ]
}

pub fn schema() -> Vec<(&'static str, Vec<&'static str>)> {
    code_schema().into_iter()
    .chain(compiler_schema().into_iter())
    .chain(editor_schema().into_iter())
    .chain(client_schema().into_iter())
    .collect()
    }

macro_rules! find_pattern {
    ( (= $name:expr) ) => {{ $name }};
    ( _ ) => {{ &Value::Null }};
    ( $name:ident ) => {{ &Value::Null }};
}

macro_rules! find_binding {
    ( (= $name:expr) ) => { _ };
    ( _ ) => { _ };
    ( $name:ident ) => { ref $name };
}

macro_rules! find {
    ($table:expr, [ $($pattern:tt),* ]) => {{
        $table.find(vec![$( find_pattern!( $pattern ) ),*])
    }};
    ($table:expr, [ $($pattern:tt),* ], $body:expr) => {{
        for row in find!($table, [ $($pattern),* ]).into_iter() {
            match row {
                [$( find_binding!($pattern) ),*] => $body,
                other => panic!("Did not expect {:?} in find!", other),
            }
        }
    }};
}

macro_rules! dont_find {
    ($table:expr, [ $($pattern:tt),* ]) => {{
        $table.dont_find(vec![$( find_pattern!( $pattern ) ),*])
    }};
    ($table:expr, [ $($pattern:tt),* ], $body:expr) => {{
        if dont_find!($table, [ $($pattern),* ]) {
            $body
        }
    }};
}

macro_rules! insert {
    ($table:expr, [ $($value:expr),* ]) => {{
        $table.index.insert(vec![$( { let value: Value = $value.to_owned(); value } ),*])
    }}
}

macro_rules! remove {
    ($table:expr, [ $($pattern:tt),* ]) => {{
        for row in find!($table, [ $($pattern),* ]).into_iter() {
            $table.index.remove(row);
        }
    }}
}

fn check_fields<S: AsRef<str>>(table: &Relation, fields: Vec<S>) {
    for (ix, field) in fields.iter().enumerate() {
        assert_eq!(&table.names[ix][..], field.as_ref());
    }
}

fn group_by(input_table: &Relation, key_len: usize) -> Vec<Vec<Vec<Value>>> {
    let mut groups = Vec::new();
    match input_table.index.iter().next() {
        Some(row) => {
            let mut key = &row[..key_len];
            let mut group = Vec::new();
            for row in input_table.index.iter() {
                if &row[..key_len] != key {
                    key = &row[..key_len];
                    groups.push(group);
                    group = Vec::new();
                }
                group.push(row.clone());
            }
            groups.push(group);
        }
        None => ()
    }
    groups
}

fn ordinal_by(input_table: &Relation, output_table: &mut Relation, key_fields: &[&str]) {
    let key_len = key_fields.len();
    check_fields(input_table, key_fields.to_owned());
    check_fields(output_table, {
        let mut names = input_table.names.clone();
        names.insert(key_len, "ix".to_owned());
        names
    });
    for group in group_by(input_table, key_len).into_iter() {
        let mut ix = 0;
        for mut row in group.into_iter() {
            row.insert(key_len, Value::Float(ix as f64));
            output_table.index.insert(row);
            ix += 1;
        }
    }
}

fn count_by(input_table: &Relation, output_table: &mut Relation, key_fields: &[&str]) {
    let key_len = key_fields.len();
    check_fields(input_table, key_fields.to_owned());
    check_fields(output_table, {
        let mut names = key_fields.to_owned();
        names.push(&"num");
        names
    });
    for group in group_by(input_table, key_fields.len()).into_iter() {
        let count = group.len();
        let mut row = group[0][0..key_len].to_owned();
        row.push(Value::Float(count as f64));
        output_table.index.insert(row);
    }
}

fn plan(flow: &Flow) {
    use value::Value::*;

    let view_table = flow.get_output("view");
    let field_table = flow.get_output("field");
    let source_table = flow.get_output("source");
    let variable_table = flow.get_output("variable");
    let constant_table = flow.get_output("constant");
    let binding_table = flow.get_output("binding");
    let select_table = flow.get_output("select");
    let chunked_source_table = flow.get_output("chunked source");
    let grouped_field_table = flow.get_output("grouped field");
    let sorted_field_table = flow.get_output("sorted field");
    let ordinal_binding_table = flow.get_output("ordinal binding");
    let negated_source_table = flow.get_output("negated source");

    let mut view_dependency_pre_table = flow.overwrite_output("view dependency (pre)");
    find!(view_table, [view, _], {
        find!(source_table, [(= view), source, source_view], {
            find!(view_table, [(= source_view), source_kind], {
                if source_kind.as_str() != "primitive" {
                    insert!(view_dependency_pre_table, [view, source, source_view]);
                }
            })
        })
    });

    let mut view_dependency_table = flow.overwrite_output("view dependency");
    ordinal_by(&*view_dependency_pre_table, &mut *view_dependency_table, &["downstream view"]);

    // TODO actually schedule sensibly
    // TODO warn about cycles through aggregates
    let mut view_schedule_pre_table = flow.overwrite_output("view schedule (pre)");
    find!(view_table, [view, kind], {
        if kind.as_str() != "primitive" {
            insert!(view_schedule_pre_table, [view, kind]);
        }
    });

    let mut view_schedule_table = flow.overwrite_output("view schedule");
    ordinal_by(&*view_schedule_pre_table, &mut *view_schedule_table, &[]);

    let mut provides_table = flow.overwrite_output("provides");
    let mut requires_table = flow.overwrite_output("requires");
    find!(variable_table, [view, variable], {
        find!(binding_table, [(= variable), source, field], {
            dont_find!(negated_source_table, [(= view), (= source)], {
                find!(field_table, [_, (= field), field_kind], {
                    match field_kind.as_str() {
                        "output" => insert!(provides_table, [view, source, variable]),
                        _ => insert!(requires_table, [view, source, variable]),
                    };
                });
            });
        });
    });
    find!(variable_table, [view, variable], {
        find!(ordinal_binding_table, [(= variable), source], {
            dont_find!(negated_source_table, [(= view), (= source)], {
                insert!(provides_table, [view, source, variable]);
            });
        });
    });
    find!(variable_table, [view, variable], {
        find!(binding_table, [(= variable), source, _], {
            find!(negated_source_table, [(= view), (= source)], {
                find!(provides_table, [(= view), _, (= variable)], {
                    // negated sources treat fields as input if they are bound elsewhere
                    insert!(requires_table, [view, source, variable]);
                });
            });
        });
    });

    let mut source_schedule_pre_table = flow.overwrite_output("source schedule (pre)");
    let mut variable_schedule_pre_table = flow.overwrite_output("variable schedule (pre)");
    let mut pass = 0;
    {
        find!(constant_table, [variable, _], {
            find!(variable_table, [view, (= variable)], {
                insert!(variable_schedule_pre_table, [view, Float(pass as f64), variable]);
            });
        });
        pass += 1;
    }
    loop {
        let mut unscheduled_source_table = flow.overwrite_output("unscheduled source");
        find!(view_table, [view, _], {
            find!(source_table, [(= view), source, _], {
                dont_find!(source_schedule_pre_table, [(= view), _, (= source)], {
                    insert!(unscheduled_source_table, [view, source]);
                });
            });
        });

        let mut unschedulable_source_table = flow.overwrite_output("unschedulable source");
        find!(unscheduled_source_table, [view, source], {
            find!(requires_table, [(= view), (= source), variable], {
                dont_find!(variable_schedule_pre_table, [(= view), _, (= variable)], {
                    insert!(unschedulable_source_table, [view, source, variable]);
                });
            });
        });

        let mut schedulable_source_table = flow.overwrite_output("schedulable source");
        find!(unscheduled_source_table, [view, source], {
            dont_find!(unschedulable_source_table, [(= view), (= source), _], {
                insert!(schedulable_source_table, [view, source]);
            })
        });

        find!(schedulable_source_table, [view, source], {
            insert!(source_schedule_pre_table, [view, Float(pass as f64), source]);
        });

        find!(schedulable_source_table, [view, source], {
            find!(provides_table, [(= view), (= source), variable], {
                dont_find!(variable_schedule_pre_table, [(= view), _, (= variable)], {
                    insert!(variable_schedule_pre_table, [view, Float(pass as f64), variable]);
                });
            });
        });

        if schedulable_source_table.index.len() == 0 {
            if unscheduled_source_table.index.len() == 0 {
                break; // done
            } else {
                panic!("Cannot schedule {:#?}", unschedulable_source_table);
            }
        }

        pass += 1;
    }

    let mut source_schedule_table = flow.overwrite_output("source schedule");
    ordinal_by(&*source_schedule_pre_table, &mut *source_schedule_table, &["view"]);

    let mut variable_schedule_table = flow.overwrite_output("variable schedule");
    ordinal_by(&*variable_schedule_pre_table, &mut *variable_schedule_table, &["view"]);

    let mut constrained_binding_table = flow.overwrite_output("constrained binding");
    find!(variable_table, [view, variable], {
        find!(constant_table, [(= variable), _], {
            find!(binding_table, [(= variable), source, field], {
                insert!(constrained_binding_table, [variable, source, field]);
            });
        });
    });
    find!(variable_table, [view, variable], {
        find!(binding_table, [(= variable), source, field], {
            find!(binding_table, [(= variable), other_source, other_field], {
                find!(source_schedule_table, [(= view), source_ix, _, (= source)], {
                    find!(source_schedule_table, [(= view), other_source_ix, _, (= other_source)], {
                        if (other_source_ix < source_ix)
                        // arbitrary field ordering, just to have to pick one to be the unconstrained binding
                        || (other_source_ix == source_ix && other_field < field) {
                            insert!(constrained_binding_table, [variable, source, field]);
                        }
                    });
                });
            });
        });
    });

    let mut compiler_index_layout_table = flow.overwrite_output("compiler index layout");
    for (view, names) in schema().into_iter() {
        for (ix, name) in names.into_iter().enumerate() {
            insert!(compiler_index_layout_table,
                [string!("{}", view), Float(ix as f64), string!("{}: {}", view, name), string!("{}", name)]);
        }
    }
    for (view, scalar_input_names, vector_input_names, output_names) in primitive::primitives().into_iter() {
        for (ix, name) in
        scalar_input_names.into_iter()
        .chain(vector_input_names.into_iter())
        .chain(output_names.into_iter())
        .enumerate() {
            insert!(compiler_index_layout_table,
                [string!("{}", view), Float(ix as f64), string!("{}: {}", view, name), string!("{}", name)]);
        }
    }

    let mut default_index_layout_table = flow.overwrite_output("default index layout");
    ordinal_by(&*field_table, &mut *default_index_layout_table, &["view"]);

    let mut index_layout_table = flow.overwrite_output("index layout");
    find!(view_table, [view, _], {
        find!(compiler_index_layout_table, [(= view), field_ix, field, name], {
            insert!(index_layout_table, [view, field_ix, field, name]);
        });
        dont_find!(compiler_index_layout_table, [(= view), _, _, _], {
            find!(default_index_layout_table, [(= view), field_ix, field, _], {
                insert!(index_layout_table, [view, field_ix, field, string!("")]);
            });
        });
    });

    let mut number_of_fields_table = flow.overwrite_output("number of fields");
    count_by(&*index_layout_table, &mut *number_of_fields_table, &["view"]);

    let mut non_sorted_field_pre_table = flow.overwrite_output("non-sorted field (pre)");
    find!(view_table, [view, kind], {
        if kind.as_str() == "join" {
            find!(source_table, [(= view), source, source_view], {
                find!(field_table, [(= source_view), field, _], {
                    dont_find!(grouped_field_table, [(= view), (= source), (= field)], {
                        dont_find!(sorted_field_table, [(= view), (= source), _, (= field), _], {
                            insert!(non_sorted_field_pre_table, [view, source, field]);
                        });
                    });
                });
            });
        }
    });

    let mut non_sorted_field_table = flow.overwrite_output("non-sorted field");
    ordinal_by(&*non_sorted_field_pre_table, &mut *non_sorted_field_table, &["view", "source"]);

    // rest of this is just denormalising for `create`

    let mut output_layout_table = flow.overwrite_output("output layout");
    find!(index_layout_table, [view, field_ix, field, name], {
        find!(view_schedule_table, [view_ix, (= view), _], {
            insert!(output_layout_table, [view_ix, field_ix, field, name]);
        });
    });

    let mut downstream_layout_table = flow.overwrite_output("downstream layout");
    find!(view_dependency_table, [downstream_view, ix, _, upstream_view], {
        find!(view_schedule_table, [downstream_view_ix, (= downstream_view), _], {
            find!(view_schedule_table, [upstream_view_ix, (= upstream_view), _], {
                insert!(downstream_layout_table, [downstream_view_ix, ix, upstream_view_ix]);
            });
        });
    });

    let mut number_of_variables_pre_table = flow.overwrite_output("number of variables (pre)");
    count_by(&*variable_schedule_table, &mut *number_of_variables_pre_table, &["view"]);

    let mut number_of_variables_table = flow.overwrite_output("number of variables");
    find!(number_of_variables_pre_table, [view, num], {
        find!(view_schedule_table, [view_ix, (= view), _], {
            insert!(number_of_variables_table, [view_ix, num]);
        });
    });

    let mut constant_layout_table = flow.overwrite_output("constant layout");
    find!(constant_table, [variable, value], {
        find!(variable_table, [view, (= variable)], {
            find!(view_schedule_table, [view_ix, (= view), _], {
                find!(variable_schedule_table, [(= view), variable_ix, _, (= variable)], {
                    insert!(constant_layout_table, [view_ix, variable_ix, value]);
                });
            });
        });
    });

    let mut source_layout_table = flow.overwrite_output("source layout");
    find!(view_schedule_table, [view_ix, view, _], {
        find!(source_schedule_table, [(= view), source_ix, _, source], {
            find!(source_table, [(= view), (= source), source_view], {
                find!(view_table, [(= source_view), kind], {
                    let chunked = !dont_find!(chunked_source_table, [(= view), (= source)]);
                    let negated = !dont_find!(negated_source_table, [(= view), (= source)]);
                    if kind.as_str() == "primitive" {
                        insert!(source_layout_table, [view_ix, source_ix, source_view, Bool(chunked), Bool(negated)]);
                    } else {
                        find!(view_dependency_table, [(= view), input_ix, (= source), (= source_view)], {
                            insert!(source_layout_table, [view_ix, source_ix, input_ix, Bool(chunked), Bool(negated)]);
                        });
                    }
                });
            });
        });
    });

    let mut binding_layout_table = flow.overwrite_output("binding layout");
    find!(view_schedule_table, [view_ix, view, _], {
        find!(source_schedule_table, [(= view), source_ix, _, source], {
            find!(source_table, [(= view), (= source), source_view], {
                find!(index_layout_table, [(= source_view), field_ix, field, _], {
                    find!(binding_table, [variable, (= source), (= field)], {
                        find!(variable_schedule_table, [(= view), variable_ix, _, (= variable)], {
                            find!(field_table, [(= source_view), (= field), field_kind], {
                                let unconstrained = dont_find!(constrained_binding_table, [(= variable), (= source), (= field)]);
                                let kind = match (field_kind.as_str(), unconstrained) {
                                    ("scalar input", _) => string!("input"),
                                    ("vector input", _) => string!("input"),
                                    ("output", false) => string!("constraint"),
                                    ("output", true) => string!("output"),
                                    other => panic!("Unknown field kind: {:?}", other),
                                };
                                insert!(binding_layout_table, [view_ix, source_ix, field_ix, variable_ix, kind]);
                            });
                        });
                    });
                });
            });
        });
    });
    find!(ordinal_binding_table, [variable, source], {
        find!(variable_schedule_table, [view, variable_ix, _, (= variable)], {
            find!(view_schedule_table, [view_ix, (= view), _], {
                find!(source_schedule_table, [(= view), source_ix, _, (= source)], {
                    find!(source_table, [(= view), (= source), source_view], {
                        find!(number_of_fields_table, [(= source_view), number_of_fields], {
                            insert!(binding_layout_table, [view_ix, source_ix, number_of_fields, variable_ix, string!("output")]);
                        });
                    });
                });
            });
        });
    });

    let mut select_layout_table = flow.overwrite_output("select layout");
    find!(view_schedule_table, [view_ix, view, _], {
        find!(index_layout_table, [(= view), field_ix, field, _], {
            find!(select_table, [(= view), (= field), variable], {
                find!(variable_schedule_table, [(= view), variable_ix, _, (= variable)], {
                    insert!(select_layout_table, [view_ix, field_ix, variable_ix]);
                });
            });
        });
    });

    let mut grouped_field_layout_table = flow.overwrite_output("grouped field layout");
    find!(grouped_field_table, [view, source, field], {
        find!(view_schedule_table, [view_ix, (= view), _], {
            find!(source_schedule_table, [(= view), source_ix, _, (= source)], {
                find!(source_table, [(= view), (= source), source_view], {
                    find!(index_layout_table, [(= source_view), field_ix, (= field), _], {
                        insert!(grouped_field_layout_table, [view_ix, source_ix, field_ix]);
                    });
                });
            });
        });
    });

    let mut sorted_field_layout_table = flow.overwrite_output("sorted field layout");
    find!(sorted_field_table, [view, source, ix, field, direction], {
        find!(view_schedule_table, [view_ix, (= view), _], {
            find!(source_schedule_table, [(= view), source_ix, _, (= source)], {
                find!(source_table, [(= view), (= source), source_view], {
                    find!(index_layout_table, [(= source_view), field_ix, (= field), _], {
                        insert!(sorted_field_layout_table, [view_ix, source_ix, ix, field_ix, direction]);
                    });
                });
            });
        });
    });

    let mut non_sorted_field_layout_table = flow.overwrite_output("non-sorted field layout");
    find!(non_sorted_field_table, [view, source, ix, field], {
        find!(view_schedule_table, [view_ix, (= view), _], {
            find!(source_schedule_table, [(= view), source_ix, _, (= source)], {
                find!(source_table, [(= view), (= source), source_view], {
                    find!(index_layout_table, [(= source_view), field_ix, (= field), _], {
                        insert!(non_sorted_field_layout_table, [view_ix, source_ix, ix, field_ix]);
                    });
                });
            });
        });
    });
}

fn push_at<T>(items: &mut Vec<T>, ix: &Value, item: T) {
    assert_eq!(items.len(), ix.as_usize());
    items.push(item);
}

fn create(flow: &Flow) -> Flow {
    use value::Value::*;

    let mut nodes = Vec::new();
    let mut dirty = BitSet::new();
    let mut outputs = Vec::new();

    find!(flow.get_output("view schedule"), [view_ix, view, kind], {
        nodes.push(Node{
            id: view.as_str().to_owned(),
            view: match kind.as_str() {
                "join" => View::Join(Join{
                    constants: vec![],
                    sources: vec![],
                    select: vec![],
                }),
                _ => {
                    println!("Unimplemented: create for {:?} {:?} {:?}", view_ix, view, kind);
                    View::Table(Table{insert:None, remove:None}) // dummy node
                }
            },
            upstream: vec![],
            downstream: vec![],
        });
        dirty.insert(view_ix.as_usize());
        outputs.push(RefCell::new(Relation::new(
            view.as_str().to_owned(),
            vec![],
            vec![],
            )));
    });

    find!(flow.get_output("output layout"), [view_ix, field_ix, field, name], {
        let mut output = outputs[view_ix.as_usize()].borrow_mut();
        push_at(&mut output.fields, field_ix, field.as_str().to_owned());
        push_at(&mut output.names, field_ix, name.as_str().to_owned());
    });

    find!(flow.get_output("downstream layout"), [downstream_ix, ix, upstream_ix], {
        push_at(&mut nodes[downstream_ix.as_usize()].upstream, ix, upstream_ix.as_usize());
        nodes[upstream_ix.as_usize()].downstream.push(downstream_ix.as_usize());
    });

    find!(flow.get_output("number of variables"), [view_ix, num], {
        match &mut nodes[view_ix.as_usize()].view {
            &mut View::Join(ref mut join) => join.constants = vec![Null; num.as_usize()],
            other => println!("Unimplemented: variables for {:?} {:?}", view_ix, other),
        }
    });

    find!(flow.get_output("constant layout"), [view_ix, variable_ix, value], {
        match &mut nodes[view_ix.as_usize()].view {
            &mut View::Join(ref mut join) => join.constants[variable_ix.as_usize()] = value.clone(),
            other => println!("Unimplemented: variables for {:?} {:?}", view_ix, other),
        }
    });

    find!(flow.get_output("source layout"), [view_ix, source_ix, input, chunked, negated], {
        match &mut nodes[view_ix.as_usize()].view {
            &mut View::Join(ref mut join) => {
                let source = Source{
                    input: match input {
                        &String(ref primitive) => Input::Primitive{
                            primitive: Primitive::from_str(primitive),
                            input_bindings: vec![],
                        },
                        &Float(upstream_view_ix) => Input::View{
                            input_ix: upstream_view_ix as usize,
                        },
                        other => panic!("Unknown input type: {:?}", other),
                    },
                    grouped_fields: vec![],
                    sorted_fields: vec![],
                    chunked: chunked.as_bool(),
                    negated: negated.as_bool(),
                    constraint_bindings: vec![],
                    output_bindings: vec![],
                };
                push_at(&mut join.sources, source_ix, source);
            }
            other => println!("Unimplemented: sources for {:?} {:?}", view_ix, other),
        }
    });

    find!(flow.get_output("binding layout"), [view_ix, source_ix, field_ix, variable_ix, kind], {
        match &mut nodes[view_ix.as_usize()].view {
            &mut View::Join(ref mut join) => {
                let source = &mut join.sources[source_ix.as_usize()];
                let binding = (field_ix.as_usize(), variable_ix.as_usize());
                match (kind.as_str(), &mut source.input) {
                    ("input", &mut Input::Primitive{ref mut input_bindings, ..}) => input_bindings.push(binding),
                    ("constraint", _) => source.constraint_bindings.push(binding),
                    ("output", _) => source.output_bindings.push(binding),
                    other => panic!("Unexpected binding kind / input combo: {:?}", other),
                }
            }
            other => println!("Unimplemented: bindings for {:?} {:?}", view_ix, other),
        }
    });

    find!(flow.get_output("select layout"), [view_ix, field_ix, variable_ix], {
        match &mut nodes[view_ix.as_usize()].view {
            &mut View::Join(ref mut join) => {
                push_at(&mut join.select, field_ix, variable_ix.as_usize());
            }
            other => println!("Unimplemented: bindings for {:?} {:?}", view_ix, other),
        }
    });

    find!(flow.get_output("grouped field layout"), [view_ix, source_ix, field_ix], {
        match &mut nodes[view_ix.as_usize()].view {
            &mut View::Join(ref mut join) => {
                join.sources[source_ix.as_usize()].grouped_fields.push(field_ix.as_usize());
            }
            other => panic!("Grouped fields given for non-join view {:?} {:?}", view_ix, other),
        }
    });

    find!(flow.get_output("sorted field layout"), [view_ix, source_ix, ix, field_ix, direction], {
        match &mut nodes[view_ix.as_usize()].view {
            &mut View::Join(ref mut join) => {
                let direction = match direction.as_str() {
                    "ascending" => Direction::Ascending,
                    "descending" => Direction::Descending,
                    _ => panic!("Unknown direction {:?}", direction),
                };
                push_at(&mut join.sources[source_ix.as_usize()].sorted_fields, ix, (field_ix.as_usize(), direction));
            }
            other => panic!("Sorted fields given for non-join view {:?} {:?}", view_ix, other),
        }
    });

    find!(flow.get_output("non-sorted field layout"), [view_ix, source_ix, _, field_ix], {
        match &mut nodes[view_ix.as_usize()].view {
            &mut View::Join(ref mut join) => {
                let direction = Direction::Ascending;
                join.sources[source_ix.as_usize()].sorted_fields.push((field_ix.as_usize(), direction));
            }
            other => panic!("Sorted fields given for non-join view {:?} {:?}", view_ix, other),
        }
    });

    Flow{
        nodes: nodes,
        dirty: dirty,
        outputs: outputs,
        needs_recompile: false,
    }
}

fn reuse_state(old_flow: &mut Flow, new_flow: &mut Flow) {
    let nodes = replace(&mut old_flow.nodes, vec![]);
    let outputs = replace(&mut old_flow.outputs, vec![]);
    for (old_node, old_output) in nodes.into_iter().zip(outputs.into_iter()) {
        if let Some(new_ix) = new_flow.get_ix(&old_node.id[..]) {
            let old_output = old_output.into_inner();
            let mut new_output = new_flow.outputs[new_ix].borrow_mut();
            if new_output.fields == old_output.fields {
                new_output.index = old_output.index;
            } else if let Some(mapping) = mapping(&old_output.fields[..], &new_output.fields[..]) {
                for values in old_output.index.into_iter() {
                    new_output.index.insert(with_mapping(values, &mapping[..]));
                }
            } else {
                println!("Warning, cannot migrate state for: {:?}", old_node.id);
            }
        }
    }
}

pub fn recompile(old_flow: &mut Flow) {
    plan(old_flow);
    let mut new_flow = create(old_flow);
    reuse_state(old_flow, &mut new_flow);
    *old_flow = new_flow;
}

pub fn bootstrap(flow: &mut Flow) {
    let schema = schema();
    for &(view, ref names) in schema.iter() {
        flow.nodes.push(Node{
            id: format!("{}", view),
                view: View::Table(Table{insert: None, remove: None}), // dummy node, replaced by recompile
                upstream: Vec::new(),
                downstream: Vec::new(),
            });
        let fields = names.iter().map(|name| format!("{}: {}", view, name)).collect();
        let names = names.iter().map(|name| format!("{}", name)).collect();
        flow.outputs.push(RefCell::new(Relation::new(format!("{}", view), fields, names)));
    }
    {
        let mut view_table = flow.overwrite_output("view");
        let mut field_table = flow.overwrite_output("field");
        let mut tag_table = flow.overwrite_output("tag");
        let mut display_name_table = flow.overwrite_output("display name");
        let mut display_order_table = flow.overwrite_output("display order");
        let mut editor_item_table = flow.overwrite_output("editor item");

        for (view, _) in code_schema().into_iter() {
            tag_table.index.insert(vec![string!("{}", view), string!("editor")]);
            tag_table.index.insert(vec![string!("{}", view), string!("hidden")]);
        }

        for (view, _) in compiler_schema().into_iter() {
            tag_table.index.insert(vec![string!("{}", view), string!("hidden")]);
        }

        for (view, _) in editor_schema().into_iter() {
            tag_table.index.insert(vec![string!("{}", view), string!("editor")]);
            tag_table.index.insert(vec![string!("{}", view), string!("hidden")]);
        }

        for (view, fields) in client_schema().into_iter() {
            tag_table.index.insert(vec![string!("{}", view), string!("client")]);
            tag_table.index.insert(vec![string!("{}", view), string!("hidden")]);
            let has_session = fields.into_iter().any(|name| name == "session");
            if has_session {
                tag_table.index.insert(vec![string!("{}: {}", view, "session"), string!("session")]);
            }
        }

        for (view, names) in schema.into_iter() {
            view_table.index.insert(vec![string!("{}", view), string!("table")]);
            display_name_table.index.insert(vec![string!("{}", view), string!("{}", view)]);
            editor_item_table.index.insert(vec![string!("{}", view), string!("table")]);

            let mut ix = 0;
            for name in names.into_iter() {
                field_table.index.insert(vec![string!("{}", view), string!("{}: {}", view, name), string!("output")]);
                display_name_table.index.insert(vec![string!("{}: {}", view, name), string!("{}", name)]);
                display_order_table.index.insert(vec![string!("{}: {}", view, name), Value::Float(ix as f64)]);
                ix -= 1;
            }
        }

        for (primitive, scalar_inputs, vector_inputs, outputs) in primitive::primitives().into_iter() {
            view_table.index.insert(vec![string!("{}", primitive), string!("primitive")]);
            display_name_table.index.insert(vec![string!("{}", primitive), string!("{}", primitive)]);
            for name in scalar_inputs.into_iter() {
                field_table.index.insert(vec![string!("{}", primitive), string!("{}: {}", primitive, name), string!("scalar input")]);
                display_name_table.index.insert(vec![string!("{}: {}", primitive, name), string!("{}", name)]);
            }
            for name in vector_inputs.into_iter() {
                field_table.index.insert(vec![string!("{}", primitive), string!("{}: {}", primitive, name), string!("vector input")]);
                display_name_table.index.insert(vec![string!("{}: {}", primitive, name), string!("{}", name)]);
            }
            for name in outputs.into_iter() {
                field_table.index.insert(vec![string!("{}", primitive), string!("{}: {}", primitive, name), string!("output")]);
                display_name_table.index.insert(vec![string!("{}: {}", primitive, name), string!("{}", name)]);
            }
        }
    }
    recompile(flow); // bootstrap away our dummy nodes
}
