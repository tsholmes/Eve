// 4 bits
// array 16
// no path compression
// mix bytes
// entirely persistent, bulk update- sort by path and return finish ix
// counting of values
// how to walk up on delete? return true/false for empty?
// leaves are just non-nodes?

// --- start of cljs.core ---

int_rotate_left = (function int_rotate_left(x,n){return ((x << n) | (x >>> (- n)));
});
if((typeof Math.imul !== 'undefined') && (!(((function (){var G__12618 = (4294967295);var G__12619 = (5);return (Math.imul.cljs$core$IFn$_invoke$arity$2 ? Math.imul.cljs$core$IFn$_invoke$arity$2(G__12618,G__12619) : Math.imul.call(null,G__12618,G__12619));
})() === (0)))))
{imul = (function imul(a,b){var G__12622 = a;var G__12623 = b;return (Math.imul.cljs$core$IFn$_invoke$arity$2 ? Math.imul.cljs$core$IFn$_invoke$arity$2(G__12622,G__12623) : Math.imul.call(null,G__12622,G__12623));
});
} else
{imul = (function imul(a,b){var ah = ((a >>> (16)) & (65535));var al = (a & (65535));var bh = ((b >>> (16)) & (65535));var bl = (b & (65535));return (((al * bl) + ((((ah * bl) + (al * bh)) << (16)) >>> (0))) | (0));
});
}
m3_seed = (0);
m3_C1 = (3432918353);
m3_C2 = (461845907);
m3_mix_K1 = (function m3_mix_K1(k1){return imul(int_rotate_left(imul(k1,m3_C1),(15)),m3_C2);
});
m3_mix_H1 = (function m3_mix_H1(h1,k1){return (imul(int_rotate_left((h1 ^ k1),(13)),(5)) + (3864292196));
});
m3_fmix = (function m3_fmix(h1,len){var h1__$1 = h1;var h1__$2 = (h1__$1 ^ len);var h1__$3 = (h1__$2 ^ (h1__$2 >>> (16)));var h1__$4 = imul(h1__$3,(2246822507));var h1__$5 = (h1__$4 ^ (h1__$4 >>> (13)));var h1__$6 = imul(h1__$5,(3266489909));var h1__$7 = (h1__$6 ^ (h1__$6 >>> (16)));return h1__$7;
});
m3_hash_int = (function m3_hash_int(in$){if((in$ === (0)))
{return in$;
} else
{var k1 = m3_mix_K1(in$);var h1 = m3_mix_H1(m3_seed,k1);return m3_fmix(h1,(4));
}
});
m3_hash_unencoded_chars = (function m3_hash_unencoded_chars(in$){var h1 = (function (){var i = (1);var h1 = m3_seed;while(true){
if((i < in$.length))
{{
var G__12624 = (i + (2));
var G__12625 = m3_mix_H1(h1,m3_mix_K1((in$.charCodeAt((i - (1))) | (in$.charCodeAt(i) << (16)))));
i = G__12624;
h1 = G__12625;
continue;
}
} else
{return h1;
}
break;
}
})();var h1__$1 = ((((in$.length & (1)) === (1)))?(h1 ^ m3_mix_K1(in$.charCodeAt((in$.length - (1))))):h1);return m3_fmix(h1__$1,imul((2),in$.length));
});
hash_string = (function hash_string(s){if(!((s == null)))
{var len = s.length;if((len > (0)))
{var i = (0);var hash = (0);while(true){
if((i < len))
{{
var G__12628 = (i + (1));
var G__12629 = (imul((31),hash) + s.charCodeAt(i));
i = G__12628;
hash = G__12629;
continue;
}
} else
{return hash;
}
break;
}
} else
{return (0);
}
} else
{return (0);
}
});
hash = (function hash(o){
if(typeof o === 'number')
{return Math.floor(o) % (2147483647);
} else
{if(o === true)
{return (1);
} else
{if(o === false)
{return (0);
} else
{if(typeof o === 'string')
{return m3_hash_int(hash_string(o));
} else
{if((o == null))
{return (0);
} else
{throw new Error("Cannot hash: " + typeof(o) + " " + o);

}
}
}
}
}
});

// --- end of cljs.core ---

function makePath(branchDepth, fact) {
  assert(branchDepth <= 8);
  var len = fact.length;
  var hashes = [];
  for (var i = 0; i < len; i++) {
   hashes[i] = hash(fact[i]);
  }
  var path = [];
  var pathBits = hashes.length * 32;
  var pathChunks = pathBits / branchDepth;
  var path = new Uint8Array(pathChunks);
  for (var i = 0; i < pathBits; i++) {
    var h = hashes[i % len];
    var bit = (h >> ((i / len) | 0)) & 1;
    var chunkIx = (i / branchDepth | 0);
    path[chunkIx] = path[chunkIx] | (bit << (i % branchDepth));
  }
  return path;
}

function ZZTree(branchDepth, branchWidth, root) {
  assert(branchDepth <= 8);
  this.branchDepth = branchDepth
  this.branchWidth = branchWidth;
  this.root = root;
}

function ZZLeaf(path, facts) {
  this.path = path;
  this.facts = facts;
}

ZZTree.prototype = {
  facts: function() {
    var facts = [];
    var branches = [this.root];
    while (branches.length > 0) {
      var branch = branches.pop();
      for (var i = 0; i < this.branchWidth; i++) {
        var child = branch[i];
        if (child === undefined) {
          // pass
        }
        else if (child.constructor === ZZLeaf) {
          Array.prototype.push.apply(facts, child.facts);
        } else {
          branches.push(child);
        }
      }
    }
    return facts;
  },

  insert: function(fact) {
    var path = makePath(this.branchDepth, fact);
    var pathIx = 0;
    var root = this.root.slice();
    var branch = root;

    down: while (true) {
      var branchIx = path[pathIx];
      pathIx++;
      var child = branch[branchIx];
      if (child === undefined) {
        branch[branchIx] = new ZZLeaf(path, [fact]);
        break down;
      } else if (child.constructor === ZZLeaf) {
        if (arrayEqual(path, child.path)) { // TODO this is an expensive check?
          var facts = child.facts.slice();
          facts.push(fact);
          branch[branchIx] = new ZZLeaf(path, facts);
          break down;
        } else {
          var childBranch = Array(this.branchWidth);
          childBranch[child.path[pathIx]] = child;
          branch[branchIx] = childBranch;
          branch = childBranch;
          continue down;
        }
      } else {
        var childBranch = child.slice();
        branch[branchIx] = childBranch;
        branch = childBranch;
        continue down;
      }
    }

    return new ZZTree(this.branchDepth, this.branchWidth, root);
  },

  remove: function(fact) {
    var path = makePath(this.branchDepth, fact);
    var pathIx = 0;
    var root = this.root.slice();
    var branch = root;
    var branches = [];

    down: while (true) {
      var branchIx = path[pathIx];
      pathIx++;
      var child = branch[branchIx];
      if (child === undefined) {
        return new ZZTree(this.branchDepth, this.branchWidth, root); // nothing to clean up
      } else if (child.constructor === ZZLeaf) {
        var facts = child.facts.slice();
        splice: for (var i = 0; i < facts.length; i++) {
          if (arrayEqual(facts[i], fact)) {
            facts.splice(i, 1);
            break splice;
          }
        }
        if (facts.length > 0) {
          branch[branchIx] = new ZZLeaf(child.path, facts);
          return new ZZTree(this.branchDepth, this.branchWidth, root); // nothing to clean up
        } else {
          break down; // go clean up
        }
      } else {
        branches.push(branch);
        var childBranch = child.slice();
        branch[branchIx] = childBranch;
        branch = childBranch;
        continue down;
      }
    }

    up: while (true) {
      pathIx--;
      var branchIx = path[pathIx]
      delete branch[branchIx];
      for (var i = 0; i < this.branchWidth; i++) {
        if (branch[i] !== undefined) {
          break up; // done cleaning up
        }
      }
      branch = branches.pop();
    }

    return new ZZTree(this.branchDepth, this.branchWidth, root);
  }
}

ZZTree.empty = function(branchDepth) {
  var branchWidth = Math.pow(2,branchDepth);
  return new ZZTree(branchDepth, branchWidth, Array(branchWidth));
}

var a = ZZTree.empty(1)
.insert(["foo", 0])
.insert(["bar", 0])
.insert([0, 0])
.insert(["foo", "bar"])
.insert(["foo", "bar"])
.insert(["foo", "bar"])

var b = a
.remove(["foo", 0])
.remove(["foo", "bar"])

function bench(n) {
  console.time("insert");
  //console.profile("insert");
  var t = ZZTree.empty(4);
  for(var i = 0; i < n; i++) {
    t = t.insert([i + "zomg", i + "foo" + i, i + "asdfasd" + i]);
  }
  //console.profileEnd("insert");
  console.timeEnd("insert");
  return t;
}

// var x = bench(1000000);
