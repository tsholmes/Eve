import macros from "../../macros.sjs";

var _ = require("lodash");
var JSML = require("../jsml");
var ui = require("./");
var reactFactory = ui.reactFactory;

// Mixins
var headerMixin = {
  dragStart: function(e) {
    e.currentTarget.classList.add("dragging");
    ui.dispatch(["dragField", {table: this.props.table, field: this.props.field[0]}]);
  },
  dragEnd: function(e) {
    e.currentTarget.classList.remove("dragging");
    ui.dispatch(["clearDragField", {table: this.props.table, field: this.props.field[0]}]);
  },
  doubleClick: function(e) {
    e.stopPropagation();
    this.click(e);
  },
  wrapHeader: function(attrs) {
    var wrapper = {
      draggable: true,
      onDoubleClick: this.doubleClick,
      onClick: null,
      onDragStart: this.dragStart,
      onDragEnd: this.dragEnd
    };
    return ui.mergeAttrs(attrs, wrapper);
  }
};

// Components

var viewComponents = {
  title: reactFactory({
    mixins: [ui.mixin.contentEditable],
    commit: function() {
      if(!this.state.edit) { return; }
      ui.dispatch(["rename", {id: this.props.id, name: this.state.edit}]);
      return true;
    },
    render: function() {
      var id = this.props.id;
      var name = this.state.edit || ui.indexer.index("displayName", "lookup", [0, 1])[id];
      var label = "";
      if(ui.indexer.hasTag(id, "constant")) { label = " - constant"; }
      else if(ui.indexer.hasTag(id, "input")) { label = "- input"; }

      return JSML.react(
        ["h2",
         ["span", this.wrapEditable({key: id + "-title",}, name)],
         label]);
    }
  }),
  header: reactFactory({
    mixins: [ui.mixin.contentEditable, headerMixin],
    contextMenu: function(e) {
      e.preventDefault();
      e.stopPropagation();
      var id = this.props.field[0];
      var joins = ui.indexer.index("join", "collector", [0])[id];
      var isJoined = joins && joins.length;

      var items = [
        [0, "input", "filter", "filterField", id],
        (ui.indexer.hasTag(id, "grouped") ? [1, "text", "ungroup", "ungroupField", id] : [1, "text", "group", "groupField", id])
      ];
      if(isJoined) {
        items.push([items.length, "text", "unjoin", "unjoinField", id]);
      }
      items.push([items.length, "fieldSearcher", "join", "joinField", id])

      ui.dispatch(["contextMenu", {e: {clientX: e.clientX, clientY: e.clientY},
                                items: items}]);
    },
    commit: function() {
      unpack [id] = this.props.field;
      if(!this.state.edit) { return; }
      ui.dispatch(["rename", {id: id, name: this.state.edit}]);
      return true;
    },
    render: function() {
      unpack [id] = this.props.field;
      var name = this.state.edit || ui.indexer.index("displayName", "lookup", [0, 1])[id];
      var className = "header";
      if(ui.indexer.hasTag(id, "grouped")) {
        className += " grouped";
      }
      var opts = this.wrapEditable({
        className: className,
        key: id,
        onContextMenu: this.contextMenu
      }, name);
      opts = this.wrapHeader(opts);
      return JSML.react(["div", opts]);
    }
  }),
  addHeader: reactFactory({
    mixins: [ui.mixin.contentEditable],
    commit: function() {
      if(!this.state.edit) { return; }
      ui.dispatch(["addField", {view: this.props.view, name: this.state.edit}]);
      return true;
    },
    componentDidUpdate: function() {
      //@HACK: React doesn't correctly clear contentEditable fields
      this.getDOMNode().textContent = "";
    },
    render: function() {
      return JSML.react(["div", this.wrapEditable({
        className: "header add-header",
        key: this.props.view + "-add-header"}, "")]);
    }
  }),
  row: reactFactory({
    mixins: [/*   editableRowMixin   */], // @TODO: Fixme
    commit: function(ix) {
      var view = this.props.view;

      //if this is a constant view, then we just modify the row
      if(ui.indexer.hasTag(view, "constant")) {
        var oldRow = this.props.row;
        var newRow = oldRow.slice();
        var edits = this.state.edits;
        foreach(ix, field of newRow) {
          if(edits[ix] !== null && edits[ix] !== undefined) {
            newRow[ix] = edits[ix];
          }
        }
        ui.dispatch(["updateRow", {view: view, oldRow: oldRow, newRow: newRow}]);
      } else if(ix > -1 && this.state.edits[ix] !== undefined) { //FIXME: how is blur getting called with an ix of -1?
        //if this isn't a constant view, then we have to modify
        ui.dispatch(["updateCalculated", {view: view, field: this.props.fields[ix][0], value: this.state.edits[ix]}]);
      }
      return true;
    },
    render: function() {
      var fields = [];
      foreach(ix, field of this.props.row) {
        if(this.props.hidden[ix]) { continue; }
        fields.push(["div", {"data-ix": ix}, field]);
      }
      return JSML.react(["div", {"className": "grid-row", "key": JSON.stringify(this.props.row)}, fields]);
    }
  }),
  adderRow: reactFactory({
    mixins: [/*   editableRowMixin   */], // @TODO: FIXME
    checkComplete: function() {
      for(var i = 0, len = this.props.len; i < len; i++) {
        if(this.state.edits[i] === undefined || this.state.edits[i] === null) return false;
      }
      return true;
    },
    commit: function() {
      if(this.checkComplete()) {
        var row = this.state.edits.slice();
        ui.ui.dispatch(["addRow", {view: this.props.view, row: row}]);
        //@HACK: React doesn't correctly clear contentEditable fields
        foreach(ix, _ of row) {
          this.getDOMNode().children[ix].textContent = "";
        }
        return true;
      }
      return false;
    },
    render: function() {
      var fields = [];
      var className;
      var contentEditable;
      for(var i = 0, len = this.props.len; i < len; i++) {
        fields.push(["div", {"tabIndex": -1, "data-ix": i}]);
      }
      return JSML.react(["div", {"className": "grid-row add-row", "key": "adderRow"}, fields]);
    }
  })
};

// Tile components
// Tile content for rendering views.
var viewTile = reactFactory({
  getInitialState: function() {
    var view = ui.indexer.index("tableTile", "lookup", [0, 1])[this.props.tile];
    if(!view) { throw new Error("No view found for tile: '" + this.props.tile + "'."); }
    return {view: view};
  },
  contextMenu: function(e) {
    var isInput = ui.indexer.hasTag(this.state.view, "input");
    if(!isInput) {
      e.preventDefault();
      ui.ui.dispatch(["contextMenu", {e: {clientX: e.clientX, clientY: e.clientY},
                                items: [
                                  [0, "viewSearcher", "Add table", "addTableToView", this.state.view]
                                ]}]);
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
        ui.ui.dispatch(["addFieldToView", {view: view, field: field, current: this.state.view}]);
      }
    }
  },
  render: function() {
    var self = this;
    var view = this.state.view;
    var viewFields = ui.indexer.index("field", "collector", [1])[view] || [];
    viewFields = _.sortBy(viewFields, 2);
    var hidden = [];
    var grouped = [];
    var headers = viewFields.map(function(cur, ix) {
      hidden[ix] = ui.indexer.hasTag(cur[0], "hidden");
      if(ui.indexer.hasTag(cur[0], "grouped")) {
        grouped.push(ix);
      }
      if(!hidden[ix]) {
        return viewComponents.header({field: cur, view: view});
      }
    });

    function indexToRows(index, hidden, startIx) {
      startIx = startIx || 0;
      hidden = hidden || [];
      var rows = [];
      if(index instanceof Array) {
        rows = index.map(function factToRow(cur) {
          return viewComponents.row({row: cur, view: view, fields: viewFields, hidden: hidden});
        }).filter(Boolean);
      } else {
        var newHidden = hidden.slice();
        newHidden[startIx] = true;
        forattr(value, group of index) {
          var groupRow = ["div", {className: "grid-group"}];
          groupRow.push.apply(groupRow, indexToRows(group, newHidden, startIx + 1));
          rows.push(["div", {className: "grid-row grouped-row"},
                     ["div", {className: "grouped-field"}, value],
                     groupRow]);
        }
      }
      return rows;
    }

    var rowIndex;
    // @TODO: Reimplement grouping.
    if(grouped.length) {
      rowIndex = ui.indexer.index(view, "collector", grouped);
    } else {
      rowIndex = ui.indexer.facts(view) || [];
    }
    var rows = indexToRows(rowIndex, hidden);
    var isConstant = ui.indexer.hasTag(view, "constant");
    var isInput = ui.indexer.hasTag(view, "input");
    var className = (isConstant || isInput) ? "input-card" : "view-card";
    var content =  [viewComponents.title({id: view}),
                    (this.props.active ? ["pre", viewToDSL(view)] : null),
                    ["div", {className: "grid"},
                     ["div", {className: "grid-header"},
                      headers,
                      viewComponents.addHeader({view: view})],
                     ["div", {className: "grid-rows"},
                      rows,
                      isConstant ? this.adderRow({len: headers.length, view: view}) : null]]];
    return ui.tileWrapper({pos: this.props.pos, size: this.props.size, tile: this.props.tile, class: className, content: content, contextMenu: this.contextMenu,
                          drop: this.drop, dragOver: this.dragOver});
  }
});

ui.registerTile("view", viewTile);
ui.registerTile("table", viewTile);
