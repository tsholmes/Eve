function JSML(jsml) {
  if(jsml.render) { return jsml.render(); }
  if(!jsml || !jsml.length) { return jsml; }

  var tag = jsml[0];
  var elem = document.createElement(tag);
  var attrs = {};
  var childIx = 1;
  var children = [];
  var subChildren;
  // If second item is not an array and is an object, it's an attribute hash.
  if(jsml[1] && !jsml[1].length && typeof jsml[1] === "object" && !jsml[1].nodeName && !jsml[1].render) {
    attrs = jsml[1];
    childIx++;
    if(attrs.scroll) {
      elem.addEventListener("scroll", attrs.scroll);
    }
    if(attrs.style) {
      for(var i in attrs.style) {
        elem.style[i] = attrs.style[i];
      }
    }
    if(attrs.className) {
      elem.className = attrs.className;
    }
  }

  // Remaining strings / arrays are children.
  for(var ix = 0, len = jsml.length; ix < len; ix++) {
    var child = jsml[ix];
    if(ix < childIx || child === undefined) { continue; }

    if(child.constructor === Array && child.length) {
      if(typeof child[0] === "string" || typeof child[0] === "function") {
        elem.appendChild(JSML(child));
      } else {
        subChildren = child.map(function(cur) { return JSML(cur); });
        for(var subIx = 0, subLen = subChildren.length; subIx < subLen; subIx++) {
          var subChild = subChildren[subIx];
          elem.appendChild(subChild);
        }
      }
    } else {
      if(typeof child === "string") {
        elem.appendChild(document.createTextNode(child));
      } else if(child.render) {
        elem.appendChild(JSML(child.render()));
      }
    }
  }

  return elem;
}
