//---------------------------------------------------------
// Utils
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

function createNoop(name, defaultValue) {
  return function() {
    console.warn("Invoked unimplemented fn: '", name + "'.");
    return defaultValue;
  };
}

var client = getLocal("client", uuid());
setLocal("client", client);

export var renderers = [];

//---------------------------------------------------------
// Code Mirror
//---------------------------------------------------------
function CodeMirrorElem() {
  this.cm = new CodeMirror();
}
renderers.push(CodeMirrorElem);
CodeMirrorElem.tags = ["codemirror"];
CodeMirrorElem.prototype.wrappedNode = function() {
  return this.cm.getWrapperElement();
};

// Attributes
CodeMirrorElem.prototype.setAttribute = function(attr, value) {
  switch(attr) {
    // @FIXME: Figure out a more permanent solution for setting the value.
    case "value":
      if(!this.cm.getValue()) {
        return this.cm.doc.setValue(value);
      }
      break;
    default:
      return this.cm.setOption(attr, value);
  }
};
CodeMirrorElem.prototype.getAttribute = function(attr) {
  switch(attr) {
    case "value":
      return this.cm.doc.getValue();
    default:
      return this.cm.getOption(attr);
  }
};
CodeMirrorElem.prototype.removeAttribute = function(attr) {
  this.setAttribute(attr, null);
};

// Events
CodeMirrorElem.events = {
  change: "changes"
};
CodeMirrorElem.createHandler = function(eid, id, event, label, key, callback) {
  return function(cm) {
    var items = [];

    var value = cm.getValue();
    value = (value === undefined) ? "" : value;
    items.push(["rawEvent", client, eid, label, key, value]);
    items.push(["eventTime", client, eid, Date.now()]);
    callback({type: "event", items: items});
  };
};
CodeMirrorElem.prototype.removeEventListener = function(ev, listener) {
  var cmEv = CodeMirrorElem.events[ev];
  assert(cmEv, "Invalid CodeMirrorElem event: '" + ev + "'.");
  this.cm.off(cmEv, listener);
};
CodeMirrorElem.prototype.addEventListener = function(ev, listener) {
  var cmEv = CodeMirrorElem.events[ev];
  assert(cmEv, "Invalid CodeMirrorElem event: '" + ev + "'.");
  this.cm.on(cmEv, listener);
};
CodeMirrorElem.prototype.addedToDom = function(parent) {
    this.cm.refresh();
};

// Dom
CodeMirrorElem.prototype.parent = function() {
  return this.cm.getWrapperElement().parentNode;
};
CodeMirrorElem.prototype.children = createNoop('CodeMirrorElem.children', []);
CodeMirrorElem.prototype.appendChild = createNoop('CodeMirrorElem.appendChild');
CodeMirrorElem.prototype.removeChild = createNoop('CodeMirrorElem.removeChild');
CodeMirrorElem.prototype.insertBefore = createNoop('CodeMirrorElem.insertBefore');


//---------------------------------------------------------
// Default Dom
//---------------------------------------------------------
function DomElem(type) {
  this.elem = document.createElement(type);
}
renderers.push(DomElem);
DomElem.prototype.wrappedNode = function() {
  return this.elem;
};

// Attributes
DomElem.prototype.setAttribute = function(attr, value) {
  this.elem.setAttribute(attr, value);
};
DomElem.prototype.getAttribute = function(attr) {
    this.elem.getAttribute(attr);
};
DomElem.prototype.removeAttribute = function(attr) {
  this.elem.removeAttribute(attr);
};

// Events
DomElem.events = {
  drop: "drop",
  drag: "drag",
  mouseover: "mouseover",
  dragover: "dragover",
  dragstart: "dragstart",
  dragend: "dragend",
  mousedown: "mousedown",
  mouseup: "mouseup",
  click: "click",
  dblclick: "dblclick",
  contextmenu: "contextmenu",
  keydown: "keydown",
  keyup: "keyup",
  keypress: "keypress"
};
DomElem.mouseEvents = {
  drop: true,
  drag: true,
  mouseover: true,
  dragover: true,
  dragstart: true,
  dragend: true,
  mousedown: true,
  mouseup: true,
  click: true,
  dblclick: true,
  contextmenu: true
};
DomElem.keyEvents = {
  keydown: true,
  keyup: true,
  keypress: true
};
DomElem.createHandler = function(eid, id, event, label, key, callback) {
  return function(e) {
    var items = [];
    if(event === "dragover") {
      e.preventDefault();
      return;
    }

    if(DomElem.mouseEvents[event]) {
      items.push(["mousePosition", client, eid, e.clientX, e.clientY]);
    }

    if(DomElem.keyEvents[event]) {
      items.push(["keyboard", client, eid, e.keyCode, event]);
    }

    var value = e.target.value;
    if(event === "dragstart") {
      console.log("start: ", JSON.stringify(eid));
      e.dataTransfer.setData("eid", JSON.stringify(eid));
      value = eid;
    }
    if(event === "drop" || event === "drag" || event === "dragover" || event === "dragend") {
      console.log("drop", e.dataTransfer.getData("eid"));
      try {
        value = JSON.parse(e.dataTransfer.getData("eid"));
      } catch(e) {
        value = "";
      }
    }
    e.stopPropagation();

    value = (value === undefined) ? "" : value;
    items.push(["rawEvent", client, eid, label, key, value]);
    items.push(["eventTime", client, eid, Date.now()]);
    callback({type: "event", items: items});
  };
};
DomElem.prototype.removeEventListener = function(ev, listener) {
  this.elem.removeEventListener(ev, listener);
};
DomElem.prototype.addEventListener = function(ev, listener) {
  this.elem.addEventListener(ev, listener);
};

// Dom
DomElem.prototype.parent = function() {
  return this.elem.parentNode;
};
DomElem.prototype.children = function() {
  return this.elem.childNodes;
};
DomElem.prototype.appendChild = function(child) {
  var node = child;
  if(child.wrappedNode) {
    node = child.wrappedNode();
  }
  this.elem.appendChild(node);
};
DomElem.prototype.removeChild = function(child) {
  var node = child;
  if(child.wrappedNode) {
    node = child.wrappedNode();
  }
  this.elem.removeChild(node);
};
DomElem.prototype.insertBefore = function(child, anchor) {
  var node = child;
  var anchorNode = anchor;
  if(child.wrappedNode) {
    node = child.wrappedNode();
  }
  if(anchor.wrappedNode) {
    anchorNode = anchor.wrappedNode();
  }
  this.elem.insertBefore(node, anchorNode);
};

function SvgElem(type) {
  this.elem = document.createElementNS("http://www.w3.org/2000/svg", type);
}
renderers.push(SvgElem);
SvgElem.tags = ["svg", "path", "rect", "circle", "line", "polygon"];
SvgElem.createHandler = DomElem.createHandler;
SvgElem.events = DomElem.events;
SvgElem.prototype = DomElem.prototype;

export var specialElements = {};
renderers.forEach(function(renderer) {
  if(renderer.tags) {
    for(var i = 0, tagsLength = renderer.tags.length; i < tagsLength; i++) {
      specialElements[renderer.tags[i]] = renderer;
    }
  }
});

export function wrappedElement(type) {
  var SpecialElem = specialElements[type];
  if(SpecialElem) {
    return new SpecialElem(type);
  }
  return new DomElem(type);
}
