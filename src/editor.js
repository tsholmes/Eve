import * as uiRenderers from "./uiRenderers";

//---------------------------------------------------------
// State
//---------------------------------------------------------

function getLocal(k, otherwise) {
  if(localStorage[k]) {
    return JSON.parse(localStorage[k]);
  }
  return otherwise;
}

function setLocal(k, v) {
  localStorage[k] = JSON.stringify(v);
}

var prevVersion = getLocal("prevVersion");
var stacks = getLocal("stacks");
var exampleStacks = Object.keys(examples);
var testStacks = Object.keys(tests);


//stacks = ["Tutorial", "Incrementer", "Net worth", "Department heads", "Graph paths", "TodoMVC", "Turing machine", "Clock", "Chat", "Game", "My Stack", "Editor", "Runtime", "Editor injection"];
stacks = (stacks || []).concat(exampleStacks);
stacks.sort();
var uniqueStacks = [];
var prev;
for(var stackIx = 0; stackIx < stacks.length; stackIx++) {
  var stack = stacks[stackIx];
  if(stack !== prev) {
    prev = stack;
    uniqueStacks.push(stack);
  }
}
stacks = uniqueStacks;
setLocal("stacks", stacks);
// setLocal("Editor-code", examples["Editor"]);

var client = getLocal("client", uuid());
setLocal("client", client);

//---------------------------------------------------------
// renderer
//---------------------------------------------------------

var renderer = {"editorQueue": [], "programQueue": [], "queued": false};

function drainRenderQueue() {
  var start = now();
  editorStorage["rootParent"] = $("#cards").get(0);
  for(var i = 0, len = renderer["editorQueue"].length; i < len; i++) {
    var queued = renderer["editorQueue"][i];
    var program = queued[0];
    var diff = queued[1];
    uiDiffRenderer(diff, editorStorage, program);
  }
  renderer["editorQueue"] = [];

  storage["rootParent"] = $(".uiCard").get(0);
  if(storage["rootParent"] && renderer["programQueue"].length > 0) {
    for(var i = 0, len = renderer["programQueue"].length; i < len; i++) {
      var queued = renderer["programQueue"][i];
      var program = queued[0];
      var diff = queued[1];
      uiDiffRenderer(diff, storage, program);
    }
    var eveRoot = $(storage["builtEls"]["eve-root"].wrappedNode());
    if(!eveRoot.closest(document.documentElement).size()) {
      storage["rootParent"].appendChild(eveRoot.get(0));
    }
    renderer["programQueue"] = [];
  }
  var end = now();
  if(end - start > 10) {
    console.error("Long render: " + (end - start));
  }
//   console.log("Render loop:", end - start);
  renderer["queued"] = false;
}

function queueRender() {
  if(!renderer["queued"]) {
    renderer["queued"] = true;
    requestAnimationFrame(drainRenderQueue);
  }
}


//---------------------------------------------------------
// worker
//---------------------------------------------------------

var storage = {};
var workers = {};
var editorStorage = {"queue": [], "working": false};

function onWorkerMessage(event) {
  if(event.data.to === "uiThread") {
    switch(event.data.type) {
      case "log":
        console.log.apply(console, event.data.args);
        break;
      case "renderUI":
        if(event.data.uiContainer === "program") {
          renderer["programQueue"].push([event.data.from, event.data.diff]);
        } else {
          renderer["editorQueue"].push([event.data.from, event.data.diff]);
        }
        queueRender();
        break;
      case "kill":
        console.log("killing thread", event.data.name);
        var worker = workers[event.data.name];
        if(worker) {
          worker.terminate();
          workers[event.data.name] = null;
          if(workers["server"]) {
            workers["server"].postMessage({type: "unsubscribe", from: event.data.name, client: client});
          }
        }
        break;
      case "createThread":
        if(workers[event.data.name]) return;

        console.log("starting thread", event.data.name);
        workers[event.data.name] = new Worker("../src/worker.js");
        workers[event.data.name].onmessage = onWorkerMessage;
        workers[event.data.name].postMessage({type: "remoteInit", name: event.data.name, client: client})
        break;
    }
  } else {
    var worker = workers[event.data.to];
    if(worker) worker.postMessage(event.data);
  }
}

//---------------------------------------------------------
// stacks view
//---------------------------------------------------------

for(var i in stacks) {
  var cur = $("<div class='stack'>" + stacks[i] + "</div>");
  cur.data("stack", stacks[i]);
  $("#exampleStacks").append(cur);
}


for(var i in testStacks) {
  var cur = $("<div class='stack testStack'>" + testStacks[i] + "</div>");
  cur.data("stack", testStacks[i]);
  $("#testStacks").append(cur);
}

$("#stacksView").on("click", ".stack", function() {
  openStack($(this).data("stack"));
});

function openStacksView() {
  closeStack();
  $("#stacksView").show();
}

function closeStacksView() {
  $("#stacksView").hide();
}

//---------------------------------------------------------
// editor worker
//---------------------------------------------------------

function getEditorCode() {
  return getLocal("Runtime-code", examples["Runtime"]) + "\n" +
         getLocal("Editor-code", examples["Editor"]);
}

workers["Editor"] = new Worker("../src/worker.js");
workers["Editor"].onmessage = onWorkerMessage;
workers["Editor"].postMessage({type: "init", editor: true, name: "Editor", client: client});
workers["Editor"].postMessage({type: "compile", code: getEditorCode()});

for(var stackIx in stacks) {
  var stack = stacks[stackIx];
  workers["Editor"].postMessage({type: "compile", code: getLocal(stack + "-code", examples[stack]), subProgram: true, subProgramName: stack});
}

//---------------------------------------------------------
// open stack
//---------------------------------------------------------

function openStack(stack) {
  closeStacksView();
  $("#stack").show();
  setLocal("activeStack", stack);
  storage = {};
//   workers["program"] = new Worker("../src/worker.js");
//   workers["program"].onmessage = onWorkerMessage;
//   workers["program"].postMessage({type: "init", editor: false, name: stack});
  workers["Editor"].postMessage({type: "newProgram", programName: stack});
  editor.setValue(getLocal(stack + "-code", examples[stack] || tests[stack]));
  editor.refresh();
  onChange(editor, null);
}

$("#return").on("click", function() {
  openStacksView();
});

function closeStack() {
  setLocal("activeStack", null);
  workers["Editor"].postMessage({type: "reset"});
  $("#stack").hide();
}

//---------------------------------------------------------
// CodeMirror editor
//---------------------------------------------------------


CodeMirror.defineMode("eve", CodeMirrorModeParser);
CodeMirror.defineMIME("text/x-eve", "eve");

var editor = CodeMirror(document.querySelector("#editorContainer"), {
  value: "",
  tabSize: 2,
  matchBrackets: true,
  autoCloseBrackets: true,
  styleActiveLine: true,
  lineNumbers: true,
  extraKeys: {
    Tab: function(cm) {
      var loc = cm.getCursor();
      var char = cm.getRange({line: loc.line, ch: loc.ch - 1}, loc);
      if(char.match(/[\w]/)) {
        CodeMirror.commands.autocomplete(cm);
      } else {
        var spaces = Array(cm.getOption("indentUnit") + 1).join(" ");
        cm.replaceSelection(spaces);
      }
    }
  },
//   keyMap: "vim",
  mode:  "eve"
});

function onChange(cm, change) {
  var edValue = cm.getValue();
  var stack = getLocal("activeStack");
  setLocal(stack + "-code", edValue);

  if(stack in examples) {
    $.post("/src/examples.js/update", {stack: stack, content: edValue});
  } else if(stack in tests) {
    $.post("/src/tests.js/update", {stack: stack, content: edValue});
  }

  //Special case modifying the editor to go ahead and compile/run that into
  //the current editor process
  if(stack === "Editor") {
    workers["Editor"].postMessage({type: "compile", code: getEditorCode()});
  }
  workers["Editor"].postMessage({type: "compile", code: edValue, subProgram: true, subProgramName: stack});
}

editor.on("change", Cowboy.debounce(200, onChange));

var onEditInputCell = function(evt) {
  var tableEl = $(evt.target).parents(".card[table]");
  var table = tableEl.attr("table");
  var edValue = editor.getValue();

  // Delete old inputView
  var cardNames = /^\s*\*\s*(.*)\s*$/gm;
  var cardHeader = /^\s*~\s*(.*)\s*$/m;
  var match;
  var editedCardIx;
  var header;
  var nextCardIx;
  while(match = cardNames.exec(edValue)) {
    if(match[1] === table) {
      editedCardIx = match.index;
      header = cardHeader.exec(edValue.substring(match.index))[1];
    } else if(editedCardIx !== undefined && !nextCardIx) {
      nextCardIx = match.index;
    }
  }

  var prefix = edValue.substring(0, editedCardIx);
  var suffix = edValue.substring(nextCardIx);

  // Collate rows
  var rows = tableEl.find(".grid-row");
  var facts = [];
  for(var rowIx = 0, rowLength = rows.length; rowIx < rowLength; rowIx++) {
    var inputs = $(rows[rowIx]).find("input");
    var inputsLength = inputs.length;
    var fact = new Array(inputsLength + 1);
    fact[0] = table;
    for(var inputIx = 0; inputIx < inputsLength; inputIx++) {
      var val = inputs[inputIx].value;
      if(val === "" || isNaN(val)) {
	if(val !== "true" && val !== "false") {
	  val = "\"" + val + "\"";
	}
      }
      fact.push(val);
    }
    facts.push(fact);
  }

  // DSL-ify facts.
  var card = "* " + table + "\n";
  card += "  ~ " + header + "\n";
  card += facts.map(function(fact) {
    return "  + " + fact.slice(1).join(" ").trim();
  }).join("\n");

  editor.setValue(prefix + "\n" + card + "\n" + suffix);
};
onEditInputCell = Cowboy.debounce(200, onEditInputCell);

//---------------------------------------------------------
// UI diff element
// setAttribute
// removeAttribute
// appendChild
// removeChild
// insertBefore
// removeEventListener
// addEventListener
// .parentNode
// .style
//---------------------------------------------------------

//---------------------------------------------------------
// UI Diff
//---------------------------------------------------------
var eventId = 1;

function appendSortElement(parent, child){

  var value = child.eveSortValue;
  var children = parent.wrappedNode().childNodes;
  var startIndex = 0;
  var stopIndex = children.length - 1;

  //shortcut the common case of just appending to the end
  if(children[stopIndex].eveSortValue < value) return parent.appendChild(child);
  //shortcut the common case of just prepending to the beginning
  if(children[startIndex].eveSortValue > value) return parent.insertBefore(child, children[startIndex]);

  var middle = Math.floor((stopIndex + startIndex) / 2);
  var cur = children[middle];

  while(cur.eveSortValue !== value && startIndex < stopIndex){

    if (value < cur.eveSortValue){
      stopIndex = middle - 1;
    } else if (value > cur.eveSortValue){
      startIndex = middle + 1;
    }

    middle = Math.floor((stopIndex + startIndex)/2);
    if(cur === children[middle]) break;
    cur = children[middle];
  }

  if(cur === child) return;
  if(value > cur.eveSortValue) return parent.insertBefore(child, children[middle + 1]);
  if(value < cur.eveSortValue) return parent.insertBefore(child, cur);
  return parent.insertBefore(child, cur);
}

function uiDiffRenderer(diff, storage, program) {
  var elem_id = 0;
  var elem_type = 1;

  var text_text = 1;

  var attrs_attr = 1;
  var attrs_value = 2;

  var styles_attr = 1;
  var styles_value = 2;

  var events_event = 1;
  var events_label = 2;
  var events_key = 3;

  var child_pos = 1;
  var child_childid = 2;

  var builtEls = storage["builtEls"] || {"eve-root": uiRenderers.wrappedElement("div")};
  var handlers = storage["handlers"] || {};
  var roots = {};
  var removed = {};

  //add subProgram elements
  //capture the elements we will remove
  var remElem = diff["uiElem"].removes;
  var remElemsLen = remElem.length;
  for(var i = 0; i < remElemsLen; i++) {
    var cur = remElem[i];
    var me = builtEls[cur[elem_id]];
    removed[cur[elem_id]] = me;
  }

  //add elements
  var elem = diff["uiElem"].adds;
  var elemsLen = elem.length;
  for(var i = 0; i < elemsLen; i++) {
    var cur = elem[i];
    var tag = cur[elem_type] || "span";
    var me = builtEls[cur[elem_id]] = uiRenderers.wrappedElement(tag);
    me.wrappedNode().eveId  = cur[elem_id];
    var old = removed[cur[elem_id]];
    if(old)  {
      if(old && old.parent() && old.parent().parentNode) {
        old.parent().insertBefore(me.wrappedNode(), old.wrappedNode());
        old.parent().removeChild(old.wrappedNode());
      }
      var oldChildren = old.children(); // @TODO: Ensure this works as expected.
      while(oldChildren.length) { // @FIXME: IE Issues with array like objects
        var oldChild = oldChildren[0];
        me.appendChild(oldChild);
        if(builtEls[oldChild.eveId] && typeof builtEls[oldChild.eveId].addedToDom === "function") {
          builtEls[oldChild.eveId].addedToDom(me);
        }
      }

      //TODO: transfer attrs
      //TODO: transfer handlers
//       handlers[cur[elem_id]] = null;
      removed[cur[elem_id]] = null;
    }
  }

  //remove all elements that weren't just added
  for(var toRemove in removed) {
    var cur = removed[toRemove];
    if(!cur) continue;

    if(cur && cur.parent() && cur.parent().parentNode) {
      cur.parent().removeChild(cur.wrappedNode());
    }
    handlers[toRemove] = null;
    builtEls[toRemove] = null;
    removed[toRemove] = null;
  }

  //add text
  var text = diff["uiText"].adds;
  var textLen = text.length;
  var addedText = {};
  for(var i = 0; i < textLen; i++) {
    var cur = text[i];
    if(!builtEls[cur[elem_id]]) {
      builtEls[cur[elem_id]] = document.createTextNode(cur[text_text]);
    } else {
      builtEls[cur[elem_id]].nodeValue = cur[text_text];
    }
    addedText[cur[elem_id]] = true;
  }

  //remove text
  var text = diff["uiText"].removes;
  var textLen = text.length;
  for(var i = 0; i < textLen; i++) {
    var cur = text[i];
    var me = builtEls[cur[elem_id]];
    if(me && !addedText[cur[elem_id]]) {
      me.nodeValue = "";
      builtEls[cur[elem_id]] = null;
    }
  }

  var attrs = diff["uiAttr"].adds;
  var attrsLen = attrs.length;
  for(var i = 0; i < attrsLen; i++) {
    var cur = attrs[i];
    var el = builtEls[cur[elem_id]];
    if(!el) continue;

    if(cur[attrs_value] === false || cur[attrs_value] === "false") {
      el.removeAttribute(cur[attrs_attr]);
    } else {
      try {
        if(cur[attrs_attr] === "value") {
          if(cur[attrs_value] !== el.getAttribute("value")) el.setAttribute("value", cur[attrs_value]);
        } else if (cur[attrs_attr] === "autofocus") {
            el.wrappedNode().focus();

        } else if(cur[attrs_attr] === "tableCardInputCell") {
          // Add special-cased editor inputCell event
          el.addEventListener("blur", onEditInputCell);

        } else {
          el.setAttribute(cur[attrs_attr], cur[attrs_value]);
        }
      } catch(e) {
        console.error("invalid attribute: ", cur[attrs_attr], cur[attrs_value]);
      }
    }
  }
  // @TODO: Investigate
  var styles = diff["uiStyle"].adds;
  var stylesLen = styles.length;
  for(var i = 0; i < stylesLen; i++) {
    var cur = styles[i];
    builtEls[cur[elem_id]].style[cur[styles_attr]] = cur[styles_value];
  }

  //Remove events
  var events = diff["uiEvent"].removes;
  var eventsLen = events.length;
  for(var i = 0; i < eventsLen; i++) {
    var cur = events[i];
    if(builtEls[cur[elem_id]] && handlers[cur[elem_id]] && handlers[cur[elem_id]][cur[events_event]]) {
      var handler = handlers[cur[elem_id]][cur[events_event]];
      builtEls[cur[elem_id]].removeEventListener(cur[events_event], handler);
      handlers[cur[elem_id]][cur[events_event]] = null;
    }
  }

  var events = diff["uiEvent"].adds;
  var handlerCallback = workers[program].postMessage.bind(workers[program]);
  var eventsLen = events.length;
  for(var i = 0; i < eventsLen; i++) {
    var cur = events[i];
    if(!handlers[cur[elem_id]]) {
      handlers[cur[elem_id]] = {};
    }

    var handler = builtEls[cur[elem_id]].constructor.createHandler(eventId++, cur[elem_id], cur[events_event], cur[events_label], cur[events_key], handlerCallback);
    handlers[cur[elem_id]][cur[events_event]] = handler;
    builtEls[cur[elem_id]].addEventListener(cur[events_event], handler);
  }

  var children = diff["uiChild"].adds;
  var childrenLen = children.length;
  children.sort(function(a,b) {
    if(a[0] !== b[0]) {
      var ta = typeof(a[0]);
      var tb = typeof(b[0]);
      if(ta === tb && ta === "string") {
        return a[0].localeCompare(b[0]);
      } if(ta === "string" || tb === "string") {
        return (a[0] + "").localeCompare((b[0] + ""));
      } else {
        return a[0] - b[0];
      }
    } else {
      if(typeof a[1] === "string" || typeof b[1] === "string") {
        return (a[1] + "").localeCompare((b[1] + ""));
      } else {
        return a[1] - b[1];
      }
    }
  });
  for(var i = 0; i < childrenLen; i++) {
    var cur = children[i];
    var child = builtEls[cur[child_childid]];
    var parent = builtEls[cur[elem_id]];
    if(parent && child) {
      child.eveSortValue = cur[child_pos];
      if(child.wrappedNode) {
        child.wrappedNode().eveSortValue = cur[child_pos];
      }
      if(parent.wrappedNode().childNodes.length === 0) {
        parent.appendChild(child);
      } else {
        appendSortElement(parent, child, child.eveSortValue);
      }
      if(typeof child.addedToDom === "function") {
        child.addedToDom(parent);
      }
    }
  }

  if(!storage["builtEls"]) {
    storage["builtEls"] = builtEls;
    storage["handlers"] = handlers;
    if(storage["rootParent"]) {
      storage["rootParent"].appendChild(builtEls["eve-root"].wrappedNode());
    }
  }
}

//---------------------------------------------------------
// socket.io
//---------------------------------------------------------

if(window["io"]) {
  var socket = io.connect('/');
  socket.on("message", function (data) {
    onWorkerMessage({data: data});
  });

  var server = {
    postMessage: function(data) {
      socket.emit("message", data);
    },
    terminate: function() {}
  };

  workers["server"] = server;
}

//---------------------------------------------------------
// Go!
//---------------------------------------------------------

if(!getLocal("activeStack")) {
  openStacksView();
} else {
  openStack(getLocal("activeStack"));
}
