import macros from "../../macros.sjs";

var _ = require("lodash");
var React = require("react/addons");
var PropTypes = React.PropTypes;
var JSML = require("../jsml");
var ui = require("./");
var reactFactory = ui.reactFactory;

// Mixins
var mixin = {
  draggableField: {
    dragStart: function(e) {
      e.currentTarget.classList.add("dragging");
      ui.dispatch(["dragField", {table: this.props.view, field: this.props.id}]);
    },
    dragEnd: function(e) {
      e.currentTarget.classList.remove("dragging");
      ui.dispatch(["clearDragField", {table: this.props.view, field: this.props.id}]);
    },
    doubleClick: function(e) {
      e.stopPropagation();
      this.click(e);
    },
    wrapDraggable: function(attrs) {
      var wrapper = {
        draggable: true,
        onClick: null,
        onDoubleClick: this.doubleClick,
        onDragStart: this.dragStart,
        onDragEnd: this.dragEnd
      };
      return ui.mergeAttrs(attrs, wrapper);
    }
  }
};

// Components
var viewComponents = {
  title: reactFactory({
    mixins: [ui.mixin.contentEditable],
    displayName: "title",
    propTypes: {
      id: PropTypes.string.isRequired,
      onEdit: PropTypes.func
    },
    commit: function() {
      if(!this.state.edit || !this.state.onEdit) { return; }
      return this.state.onEdit(this.state.edit);
    },
    render: function() {
      var id = this.props.id;
      var name = this.state.edit || ui.indexer.index("displayName", "lookup", [0, 1])[id];
      var label = "";
      if(ui.indexer.hasTag(id, "constant")) { label = " - constant"; }
      else if(ui.indexer.hasTag(id, "input")) { label = " - input"; }

      return JSML.react(
        ["h2",
         ["span", this.wrapEditable({key: id + "-title",}, name)],
         label]
      );
    }
  }),

  header: reactFactory({
    mixins: [ui.mixin.contentEditable, mixin.draggableField],
    displayName: "header",
    propTypes: {
      id: PropTypes.string.isRequired,
      ix: PropTypes.number.isRequired,
      onEdit: PropTypes.func,
      showMenu: PropTypes.func,
      hidden: PropTypes.bool,
      grouped: PropTypes.bool,
      className: PropTypes.string
    },
    commit: function() {
      if(!this.state.edit || !this.props.onEdit) { return; }
      return this.props.onEdit(this.props.id, this.state.edit);
    },
    contextMenu: function(e) {
      if(!this.props.showMenu || !this.props.id) { return; }
      e.preventDefault();
      e.stopPropagation();
      var id = this.props.id;
      var joins = ui.indexer.index("join", "collector", [0])[id];
      var isJoined = joins && joins.length;
      var isGrouped = ui.indexer.hasTag(id, "grouped");
      var items = [
        [0, "input", "filter", "filterField", id]
      ];
      if(isGrouped) {
        items.push([items.length, "text", "ungroup", "ungroupField", id]);
      } else {
        items.push([items.length, "text", "group", "groupField", id]);
      }
      if(isJoined) {
        items.push([items.length, "text", "unjoin", "unjoinField", id]);
      }
      items.push([items.length, "fieldSearcher", "join", "joinField", id])

      this.props.showMenu({
        e: {clientX: e.clientX, clientY: e.clientY},
        items: items
      });
    },
    render: function() {
      var name = this.state.edit || ui.indexer.index("displayName", "lookup", [0, 1])[this.props.id];
      var className = (this.props.className || "") + " header";
      if(this.props.grouped) {
        className += " grouped";
      }
      var opts = this.wrapEditable({
        className: className,
        key: this.props.id,
        onContextMenu: this.contextMenu
      }, name);
      if(this.props.id) {
        opts = this.wrapDraggable(opts);
      }
      return JSML.react(["div", opts]);
    }
  }),

  row: reactFactory({
    displayName: "row",
    getInitialState: function() {
      return {dirtyFields: [], fact: this.props.fact.slice()};
    },
    componentWillReceiveProps: function(nextProps) {
      this.setState({fact: nextProps.fact.slice()});
    },
    propTypes: {
      fact: PropTypes.array.isRequired,
      hidden: PropTypes.array.isRequired,
      editable: PropTypes.array.isRequired,
      onEdit: PropTypes.func,
      className: PropTypes.string
    },
    fieldChanged: function(ix, value) {
      if(!this.props.onEdit) { return false; }
      var fact = this.state.fact;
      var old = this.props.fact;
      fact[ix] = value;
      var dirty = this.state.dirtyFields;
      dirty.push(ix);
      dirty = _.uniq(dirty);
      var result = this.props.onEdit(fact, old, dirty);
      if(result) {
        this.setState({dirtyFields: []});
      } else {
        this.setState({dirtyFields: dirty});
      }
      return result;
    },
    render: function() {
      var className = (this.props.className || "") + " grid-row";
      var row = ["div", {className: className, key: JSON.stringify(this.props.fact)}];
      foreach(ix, field of this.state.fact) {
        console.log("ix", ix, "v", field, "h", this.props.hidden[ix], "editable", this.props.editable[ix], "onEdit", this.props.onEdit);
        if(this.props.hidden[ix]) { continue; }
        var fieldChangedHandler = (this.props.onEdit && this.props.editable[ix] ? this.fieldChanged : undefined);
        row.push(viewComponents.field({value: field, ix: ix, onEdit: fieldChangedHandler}));
      }
      return JSML.react(row);
    }
  }),

  field: reactFactory({
    mixins: [ui.mixin.contentEditable],
    displayName: "field",
    propTypes: {
      value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
      ix: PropTypes.number.isRequired,
      onEdit: PropTypes.func,
      className: PropTypes.string
    },
    commit: function() {
      if(!this.props.onEdit) { return false; }
      var result = this.props.onEdit(this.props.ix, this.state.edit);
      if(result) {
        //@HACK: React doesn't correctly clear contentEditable fields
        // this.getDOMNode().textContent = this.props.value || "";
      }
      return result;
    },
    render: function() {
      var attrs = {className: this.props.className, "data-ix": this.props.ix};
      if(this.props.onEdit) {
        attrs = this.wrapEditable(attrs, this.props.value || "");
        return JSML.react(["div", attrs]);
      }

      return JSML.react(["div", attrs, this.props.value]);
    }
  })
}

// Tile content for rendering views.
var viewTile = reactFactory({
  getInitialState: function() {
    var view = ui.indexer.index("tableTile", "lookup", [0, 1])[this.props.tile];
    if(!view) { throw new Error("No view found for tile: '" + this.props.tile + "'."); }
    return {view: view};
  },
  componentWillReceiveProps: function(props) {
    var view = ui.indexer.index("tableTile", "lookup", [0, 1])[props.tile];
    if(!view) { throw new Error("No view found for tile: '" + props.tile + "'."); }
    this.setState({view: view});
  },
  getFields: function() {
    var fields = ui.indexer.index("field", "collector", [1])[this.state.view] || [];
    fields = _.sortBy(fields, 2);
    fields = fields.map(function(cur, ix) {
      var id = cur[0];
      return {
        id: id,
        ix: ix,
        hidden: ui.indexer.hasTag(id, "hidden"),
        grouped: ui.indexer.hasTag(cur[0], "grouped")
      };
    });
    return fields;
  },
  contextMenu: function(e) {
    var isInput = ui.indexer.hasTag(this.state.view, "input");
    if(!isInput) {
      e.preventDefault();
      ui.dispatch(["contextMenu", {
        e: {clientX: e.clientX, clientY: e.clientY},
        items: [[0, "viewSearcher", "Add table", "addTableToView", this.state.view]]
      }]);
    }
  },
  dragOver: function(e) {
    if(ui.indexer.first("dragField")) {
      //class?
      e.preventDefault();
    }
  },
  drop: function(e) {
    e.stopPropagation();
    var dragged = ui.indexer.first("dragField");
    if(dragged) {
      unpack[view, field] = dragged;
      if(this.state.view !== view) {
        ui.dispatch(["addFieldToView", {view: view, field: field, current: this.state.view}]);
      }
    }
  },

  showMenu: function(info) {
    return ui.dispatch(["contextMenu", info]);
  },

  updateTitle: function(neue) {
    ui.dispatch(["rename", {id: this.state.view, name: neue}]);
    return true;
  },
  addField: function(__, name) {
    ui.dispatch(["addField", {view: this.state.view, name: name}]);
    return true;
  },
  updateField: function(id, name) {
    ui.dispatch(["rename", {id: id, name: name}]);
    return true;
  },
  addRow: function(row) {
    // Bail if row isn't fully specified.
    foreach(field of row) {
      if(field === undefined) {
        return;
      }
    }
    ui.dispatch(["addRow", {table: this.state.view, row: row}]);
    return true;
  },
  updateRow: function(neue, old, dirty) {
    var view = this.state.view;
    var isConstant = ui.indexer.hasTag(view, "constant");
    if(isConstant) {
      ui.dispatch(["updateRow", {table: view, newRow: neue, oldRow: old}]);
    } else {
      var fields = this.getFields();
      foreach(fieldIx of dirty) {
        ui.dispatch(["updateCalculated", {table: view, field: fields[fieldIx].id, value: neue[fieldIx]}]);
      }
    }
    return true;
  },

  indexToRows: function indexToRows(index, editable, hidden, startIx) {
    startIx = startIx || 0;
    hidden = hidden || [];
    editable = editable || [];
    var rows = [];
    if(index instanceof Array) {
      var self = this;
      rows = index.map(function factToRow(cur) {
        return viewComponents.row({fact: cur, hidden: hidden, editable: editable, onEdit: self.updateRow});
      }).filter(Boolean);
    } else {
      var newHidden = hidden.slice();
      newHidden[startIx] = true;
      forattr(value, group of index) {
        var groupRow = ["div", {className: "grid-group"}];
        groupRow.push.apply(groupRow, this.indexToRows(group, editable, newHidden, startIx + 1));
        rows.push(["div", {className: "grid-row grouped-row"},
                   ["div", {className: "grouped-field"}, value], //@TODO make this a viewComponent.field.
                   groupRow]);
      }
    }
    return rows;
  },

  render: function() {
    var self = this;
    var view = this.state.view;
    var fields = this.getFields();
    var isConstant = ui.indexer.hasTag(view, "constant");
    var isInput = ui.indexer.hasTag(view, "input");
    var hidden = [];
    var editable = [];
    var grouped = [];
    var headers = [];
    foreach(ix, cur of fields) {
      hidden[ix] = cur.hidden;
      if(isConstant || ui.indexer.hasTag(cur.id, "calculated")) {
        editable[ix] = true;
      }
      if(cur.grouped) {
        grouped.push(ix);
      }
      if(!cur.hidden) {
        headers.push(viewComponents.header(ui.mergeAttrs({
          onEdit: this.updateField,
          showMenu: this.showMenu
        }, cur)));
      }
    }
    var addHeader = viewComponents.header({id: "", ix: headers.length, className: "add-header", onEdit: this.addField});
    headers.push(addHeader);

    var rowIndex;
    if(grouped.length) {
      rowIndex = ui.indexer.index(view, "collector", grouped);
    } else {
      rowIndex = ui.indexer.facts(view) || [];
    }
    var rows = this.indexToRows(rowIndex, editable, hidden);
    if(isConstant) {
      rows.push(viewComponents.row({
        fact: new Array(fields.length),
        hidden: hidden,
        editable: editable,
        className: "add-row",
        onEdit: this.addRow
      }));
    }
    //@TODO if isConstant attach an adder row.
    var className = (isConstant || isInput) ? "input-card" : "view-card";
    var content = [viewComponents.title({id: view, onEdit: this.updateTitle}),
                   (this.props.active ? ["pre", viewToDSL(view)] : null),
                   ["div", {className: "grid"},
                    ["div", {className: "grid-header"},
                     headers],
                    ["div", {className: "grid-rows"},
                     rows]]];
    return ui.tileWrapper({pos: this.props.pos, size: this.props.size, tile: this.props.tile, class: className, content: content, contextMenu: this.contextMenu,
                          drop: this.drop, dragOver: this.dragOver});
  }
});

ui.registerTile("view", viewTile);
ui.registerTile("table", viewTile);
