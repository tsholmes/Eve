var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var app_1 = require("./app");
window["eve"] = app_1.eve;
// ---------------------------------------------------------
// Token types
// ---------------------------------------------------------
(function (TokenTypes) {
    TokenTypes[TokenTypes["ENTITY"] = 0] = "ENTITY";
    TokenTypes[TokenTypes["COLLECTION"] = 1] = "COLLECTION";
    TokenTypes[TokenTypes["ATTRIBUTE"] = 2] = "ATTRIBUTE";
    TokenTypes[TokenTypes["MODIFIER"] = 3] = "MODIFIER";
    TokenTypes[TokenTypes["OPERATION"] = 4] = "OPERATION";
    TokenTypes[TokenTypes["PATTERN"] = 5] = "PATTERN";
    TokenTypes[TokenTypes["VALUE"] = 6] = "VALUE";
    TokenTypes[TokenTypes["TEXT"] = 7] = "TEXT";
})(exports.TokenTypes || (exports.TokenTypes = {}));
var TokenTypes = exports.TokenTypes;
// ---------------------------------------------------------
// Modifiers
// ---------------------------------------------------------
var modifiers = {
    "and": { and: true },
    "or": { or: true },
    "without": { deselected: true },
    "aren't": { deselected: true },
    "don't": { deselected: true },
    "not": { deselected: true },
    "isn't": { deselected: true },
    "per": { group: true },
    ",": { separator: true },
    "all": { every: true },
    "every": { every: true },
};
// ---------------------------------------------------------
// Patterns
// ---------------------------------------------------------
var patterns = {
    "older": {
        type: "rewrite",
        rewrites: [{ attribute: "age", text: "age >" }],
    },
    "younger": {
        type: "rewrite",
        rewrites: [{ attribute: "age", text: "age <" }],
    },
    "cheaper": {
        type: "rewrite",
        rewrites: [{ attribute: "price", text: "price <" }, { attribute: "cost", text: "cost <" }]
    },
    "greater than": {
        type: "rewrite",
        rewrites: [{ text: ">" }],
    },
    "years old": {
        type: "rewrite",
        rewrites: [{ attribute: "age", text: "age" }],
    },
    "sum": {
        type: "aggregate",
        op: "sum",
        args: ["value"],
    },
    "count": {
        type: "aggregate",
        op: "count",
        args: ["value"],
    },
    "average": {
        type: "aggregate",
        op: "average",
        args: ["value"],
    },
    "top": {
        type: "sort and limit",
        resultingIndirectObject: 1,
        direction: "descending",
        args: ["limit", "attribute"],
    },
    "bottom": {
        type: "sort and limit",
        resultingIndirectObject: 1,
        direction: "ascending",
        args: ["limit", "attribute"],
    },
    "highest": {
        type: "sort and limit",
        limit: 1,
        resultingIndirectObject: 0,
        direction: "descending",
        args: ["attribute"],
    },
    "lowest": {
        type: "sort and limit",
        limit: 1,
        resultingIndirectObject: 0,
        direction: "ascending",
        args: ["attribute"],
    },
    "between": {
        type: "bounds",
        args: ["lower bound", "upper bound", "attribute"],
    },
    "<": {
        type: "filter",
        op: "<",
        infix: true,
        resultingIndirectObject: 0,
        args: ["a", "b"],
    },
    ">": {
        type: "filter",
        op: ">",
        infix: true,
        resultingIndirectObject: 0,
        args: ["a", "b"],
    },
    "<=": {
        type: "filter",
        op: "<=",
        infix: true,
        resultingIndirectObject: 0,
        args: ["a", "b"],
    },
    ">=": {
        type: "filter",
        op: ">=",
        infix: true,
        resultingIndirectObject: 0,
        args: ["a", "b"],
    },
    "=": {
        type: "filter",
        op: "=",
        infix: true,
        resultingIndirectObject: 0,
        args: ["a", "b"],
    },
    "+": {
        type: "calculate",
        op: "+",
        infix: true,
        resultingIndirectObject: 0,
        args: ["a", "b"],
    },
    "-": {
        type: "calculate",
        op: "-",
        infix: true,
        resultingIndirectObject: 0,
        args: ["a", "b"],
    },
    "*": {
        type: "calculate",
        op: "*",
        infix: true,
        resultingIndirectObject: 0,
        args: ["a", "b"],
    },
    "/": {
        type: "calculate",
        op: "/",
        infix: true,
        resultingIndirectObject: 0,
        args: ["a", "b"],
    }
};
// ---------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------
function checkForToken(token) {
    var info;
    if (!token)
        return;
    var display = app_1.eve.findOne("display name", { name: token });
    if (display && (info = app_1.eve.findOne("collection", { collection: display.id }))) {
        return { found: display.id, info: info, type: TokenTypes.COLLECTION };
    }
    else if (display && (info = app_1.eve.findOne("entity", { entity: display.id }))) {
        return { found: display.id, info: info, type: TokenTypes.ENTITY };
    }
    else if (info = app_1.eve.findOne("entity eavs", { attribute: token })) {
        return { found: token, info: info, type: TokenTypes.ATTRIBUTE };
    }
    else if (info = modifiers[token]) {
        return { found: token, info: info, type: TokenTypes.MODIFIER };
    }
    else if (info = patterns[token]) {
        return { found: token, info: info, type: TokenTypes.PATTERN };
    }
    else if (token === "true" || token === "false" || token === '"true"' || token === '"false"') {
        return { found: (token === "true" || token === '"true"' ? true : false), type: TokenTypes.VALUE, valueType: "boolean" };
    }
    else if (token.match(/^-?[\d]+$/gm)) {
        return { found: JSON.parse(token), type: TokenTypes.VALUE, valueType: "number" };
    }
    else if (token.match(/^["][^"]*["]$/gm)) {
        return { found: JSON.parse(token), type: TokenTypes.VALUE, valueType: "string" };
    }
    else if (info = /^([\d]+)-([\d]+)$/gm.exec(token)) {
        return { found: token, type: TokenTypes.VALUE, valueType: "range", start: info[1], stop: info[2] };
    }
    return;
}
function getTokens(queryString) {
    // remove all non-word non-space characters
    var cleaned = queryString.replace(/'s/gi, "  ").toLowerCase();
    cleaned = cleaned.replace(/[,.?!]/gi, " , ");
    var words = cleaned.split(" ");
    var front = 0;
    var back = words.length;
    var results = [];
    var pos = 0;
    while (front < words.length) {
        var info = undefined;
        var str = words.slice(front, back).join(" ");
        var orig = str;
        // Check for the word directly
        info = checkForToken(str);
        if (!info) {
            str = pluralize(str, 1);
            // Check the singular version of the word
            info = checkForToken(str);
            if (!info) {
                // Check the plural version of the word
                str = pluralize(str, 2);
                info = checkForToken(str);
            }
        }
        if (info) {
            var found = info.found, type = info.type, valueType = info.valueType, start = info.start, stop = info.stop;
            // Create a new token
            results.push({ found: found, orig: orig, pos: pos, type: type, valueType: valueType, start: start, stop: stop, info: info.info, id: uuid(), children: [] });
            front = back;
            pos += orig.length + 1;
            back = words.length;
        }
        else if (back - 1 > front) {
            back--;
        }
        else {
            if (orig) {
                // Default case: the token is plain text
                results.push({ found: orig, orig: orig, pos: pos, type: TokenTypes.TEXT });
            }
            back = words.length;
            pos += words[front].length + 1;
            front++;
        }
    }
    return results;
}
exports.getTokens = getTokens;
// ---------------------------------------------------------
// Relationships between tokens
// ---------------------------------------------------------
(function (RelationshipTypes) {
    RelationshipTypes[RelationshipTypes["NONE"] = 0] = "NONE";
    RelationshipTypes[RelationshipTypes["ENTITY_ENTITY"] = 1] = "ENTITY_ENTITY";
    RelationshipTypes[RelationshipTypes["ENTITY_ATTRIBUTE"] = 2] = "ENTITY_ATTRIBUTE";
    RelationshipTypes[RelationshipTypes["COLLECTION_COLLECTION"] = 3] = "COLLECTION_COLLECTION";
    RelationshipTypes[RelationshipTypes["COLLECTION_INTERSECTION"] = 4] = "COLLECTION_INTERSECTION";
    RelationshipTypes[RelationshipTypes["COLLECTION_ENTITY"] = 5] = "COLLECTION_ENTITY";
    RelationshipTypes[RelationshipTypes["COLLECTION_ATTRIBUTE"] = 6] = "COLLECTION_ATTRIBUTE";
})(exports.RelationshipTypes || (exports.RelationshipTypes = {}));
var RelationshipTypes = exports.RelationshipTypes;
var tokenRelationships = (_a = {},
    _a[TokenTypes.COLLECTION] = (_b = {},
        _b[TokenTypes.COLLECTION] = findCollectionToCollectionRelationship,
        _b[TokenTypes.ENTITY] = findCollectionToEntRelationship,
        _b[TokenTypes.ATTRIBUTE] = findCollectionToAttrRelationship,
        _b
    ),
    _a[TokenTypes.ENTITY] = (_c = {},
        _c[TokenTypes.ENTITY] = findEntToEntRelationship,
        _c[TokenTypes.ATTRIBUTE] = findEntToAttrRelationship,
        _c
    ),
    _a
);
function determineRelationship(parent, child) {
    if (!tokenRelationships[parent.type] || !tokenRelationships[parent.type][child.type]) {
        return { distance: Infinity, type: RelationshipTypes.NONE };
    }
    else {
        return tokenRelationships[parent.type][child.type](parent.found, child.found);
    }
}
function entityTocollectionsArray(entity) {
    var entities = app_1.eve.find("collection entities", { entity: entity });
    return entities.map(function (a) { return a["collection"]; });
}
function extractFromUnprojected(coll, ix, field, size) {
    var results = [];
    for (var i = 0, len = coll.length; i < len; i += size) {
        results.push(coll[i + ix][field]);
    }
    return results;
}
function findCommonCollections(ents) {
    var intersection = entityTocollectionsArray(ents[0]);
    intersection.sort();
    for (var _i = 0, _a = ents.slice(1); _i < _a.length; _i++) {
        var entId = _a[_i];
        var cur = entityTocollectionsArray(entId);
        cur.sort();
        arrayIntersect(intersection, cur);
    }
    intersection.sort(function (a, b) {
        return app_1.eve.findOne("collection", { collection: a })["count"] - app_1.eve.findOne("collection", { collection: b })["count"];
    });
    return intersection;
}
function findEntToEntRelationship(ent, ent2) {
    return { distance: Infinity, type: RelationshipTypes.ENTITY_ENTITY };
}
// e.g. "salaries in engineering"
// e.g. "chris's age"
function findEntToAttrRelationship(ent, attr) {
    // check if this ent has that attr
    var directAttribute = app_1.eve.findOne("entity eavs", { entity: ent, attribute: attr });
    if (directAttribute) {
        return { distance: 0, type: RelationshipTypes.ENTITY_ATTRIBUTE };
    }
    var relationships = app_1.eve.query("")
        .select("directionless links", { entity: ent }, "links")
        .select("entity eavs", { entity: ["links", "link"], attribute: attr }, "eav")
        .exec();
    if (relationships.unprojected.length) {
        var entities = extractFromUnprojected(relationships.unprojected, 0, "link", 2);
        return { distance: 1, type: RelationshipTypes.ENTITY_ATTRIBUTE, nodes: [findCommonCollections(entities)] };
    }
    var relationships2 = app_1.eve.query("")
        .select("directionless links", { entity: ent }, "links")
        .select("directionless links", { entity: ["links", "link"] }, "links2")
        .select("entity eavs", { entity: ["links2", "link"], attribute: attr }, "eav")
        .exec();
    if (relationships2.unprojected.length) {
        var entities = extractFromUnprojected(relationships2.unprojected, 0, "link", 3);
        var entities2 = extractFromUnprojected(relationships2.unprojected, 1, "link", 3);
        return { distance: 2, type: RelationshipTypes.ENTITY_ATTRIBUTE, nodes: [findCommonCollections(entities), findCommonCollections(entities2)] };
    }
    // otherwise we assume it's direct and mark it as unfound.
    return { distance: 0, type: RelationshipTypes.ENTITY_ATTRIBUTE, unfound: true };
}
// e.g. "salaries per department"
function findCollectionToAttrRelationship(coll, attr) {
    var direct = app_1.eve.query("")
        .select("collection entities", { collection: coll }, "collection")
        .select("entity eavs", { entity: ["collection", "entity"], attribute: attr }, "eav")
        .exec();
    if (direct.unprojected.length) {
        return { distance: 0, type: RelationshipTypes.COLLECTION_ATTRIBUTE, nodes: [] };
    }
    var relationships = app_1.eve.query("")
        .select("collection entities", { collection: coll }, "collection")
        .select("directionless links", { entity: ["collection", "entity"] }, "links")
        .select("entity eavs", { entity: ["links", "link"], attribute: attr }, "eav")
        .exec();
    if (relationships.unprojected.length) {
        var entities = extractFromUnprojected(relationships.unprojected, 1, "link", 3);
        return { distance: 1, type: RelationshipTypes.COLLECTION_ATTRIBUTE, nodes: [findCommonCollections(entities)] };
    }
    var relationships2 = app_1.eve.query("")
        .select("collection entities", { collection: coll }, "collection")
        .select("directionless links", { entity: ["collection", "entity"] }, "links")
        .select("directionless links", { entity: ["links", "link"] }, "links2")
        .select("entity eavs", { entity: ["links2", "link"], attribute: attr }, "eav")
        .exec();
    if (relationships2.unprojected.length) {
        var entities = extractFromUnprojected(relationships2.unprojected, 1, "link", 4);
        var entities2 = extractFromUnprojected(relationships2.unprojected, 2, "link", 4);
        return { distance: 2, type: RelationshipTypes.COLLECTION_ATTRIBUTE, nodes: [findCommonCollections(entities), findCommonCollections(entities2)] };
    }
}
// e.g. "meetings john was in"
function findCollectionToEntRelationship(coll, ent) {
    if (coll === "collections") {
        if (app_1.eve.findOne("collection entities", { entity: ent })) {
            return { distance: 0, type: "ent->collection" };
        }
    }
    if (app_1.eve.findOne("collection entities", { collection: coll, entity: ent })) {
        return { distance: 0, type: RelationshipTypes.COLLECTION_ENTITY, nodes: [] };
    }
    var relationships = app_1.eve.query("")
        .select("collection entities", { collection: coll }, "collection")
        .select("directionless links", { entity: ["collection", "entity"], link: ent }, "links")
        .exec();
    if (relationships.unprojected.length) {
        return { distance: 1, type: RelationshipTypes.COLLECTION_ENTITY, nodes: [] };
    }
    // e.g. events with chris granger (events -> meetings -> chris granger)
    var relationships2 = app_1.eve.query("")
        .select("collection entities", { collection: coll }, "collection")
        .select("directionless links", { entity: ["collection", "entity"] }, "links")
        .select("directionless links", { entity: ["links", "link"], link: ent }, "links2")
        .exec();
    if (relationships2.unprojected.length) {
        var entities = extractFromUnprojected(relationships2.unprojected, 1, "link", 3);
        return { distance: 2, type: RelationshipTypes.COLLECTION_ENTITY, nodes: [findCommonCollections(entities)] };
    }
}
// e.g. "authors and papers"
function findCollectionToCollectionRelationship(coll, coll2) {
    // are there things in both sets?
    var intersection = app_1.eve.query(coll + "->" + coll2)
        .select("collection entities", { collection: coll }, "coll1")
        .select("collection entities", { collection: coll2, entity: ["coll1", "entity"] }, "coll2")
        .exec();
    // is there a relationship between things in both sets
    var relationships = app_1.eve.query("relationships between " + coll + " and " + coll2)
        .select("collection entities", { collection: coll }, "coll1")
        .select("directionless links", { entity: ["coll1", "entity"] }, "links")
        .select("collection entities", { collection: coll2, entity: ["links", "link"] }, "coll2")
        .group([["links", "link"]])
        .aggregate("count", {}, "count")
        .project({ type: ["links", "link"], count: ["count", "count"] })
        .exec();
    var maxRel = { count: 0 };
    for (var _i = 0, _a = relationships.results; _i < _a.length; _i++) {
        var result = _a[_i];
        if (result.count > maxRel.count)
            maxRel = result;
    }
    // we divide by two because unprojected results pack rows next to eachother
    // and we have two selects.
    var intersectionSize = intersection.unprojected.length / 2;
    if (maxRel.count > intersectionSize) {
        return { distance: 1, type: RelationshipTypes.COLLECTION_COLLECTION };
    }
    else if (intersectionSize > maxRel.count) {
        return { distance: 0, type: RelationshipTypes.COLLECTION_INTERSECTION };
    }
    else if (maxRel.count === 0 && intersectionSize === 0) {
        return;
    }
    else {
        return { distance: 1, type: RelationshipTypes.COLLECTION_COLLECTION };
    }
}
function tokensToTree(origTokens) {
    var tokens = origTokens;
    var roots = [];
    var operations = [];
    var groups = [];
    // Find the direct object
    // The direct object is the first collection we find, or if there are none,
    // the first entity, or finally the first attribute.
    var directObject;
    for (var _i = 0; _i < tokens.length; _i++) {
        var token = tokens[_i];
        if (token.type === TokenTypes.COLLECTION) {
            directObject = token;
            break;
        }
        else if (token.type === TokenTypes.ENTITY) {
            directObject = token;
        }
        else if (token.type === TokenTypes.ATTRIBUTE && !directObject) {
            directObject = token;
        }
    }
    var tree = { directObject: directObject, roots: roots, operations: operations, groups: groups };
    if (!directObject)
        return tree;
    // the direct object is always the first root
    roots.push(directObject);
    // we need to keep state as we traverse the tokens for modifiers and patterns
    var state = { patternStack: [], currentPattern: null, lastAttribute: null };
    // as we parse the query we may encounter other subjects in the sentence, we
    // need a reference to those previous subjects to see if the current token is
    // related to that or the directObject
    var indirectObject = directObject;
    // Main token loop
    for (var tokenIx = 0, len = tokens.length; tokenIx < len; tokenIx++) {
        var token = tokens[tokenIx];
        var type = token.type, info = token.info, found = token.found;
        // check if the last pass finshed our current pattern.
        if (state.currentPattern && state.currentPattern.args.length) {
            var args = state.currentPattern.args;
            var infoArgs = state.currentPattern.info.args;
            var latestArg = args[args.length - 1];
            var latestArgComplete = latestArg.type === TokenTypes.ATTRIBUTE || latestArg.type === TokenTypes.VALUE;
            while (args.length === infoArgs.length && latestArgComplete) {
                var resultingIndirectObject = state.currentPattern.info.resultingIndirectObject;
                if (resultingIndirectObject !== undefined) {
                    indirectObject = args[resultingIndirectObject];
                }
                else {
                    indirectObject = state.currentPattern;
                }
                state.currentPattern = state.patternStack.pop();
                if (!state.currentPattern)
                    break;
                args = state.currentPattern.args;
                infoArgs = state.currentPattern.info.args;
                args.push(indirectObject);
                latestArg = args[args.length - 1];
                latestArgComplete = latestArg.type === TokenTypes.ATTRIBUTE || latestArg.type === TokenTypes.VALUE;
            }
        }
        // deal with modifiers
        if (type === TokenTypes.MODIFIER) {
            // if this is a deselect modifier, we need to roll forward through the tokens
            // to figure out roughly how far the deselection should go. Also if we run into
            // an "and"" or an "or", we need to deal with that specially.
            if (info.deselected) {
                // we're going to move forward from this token and deselect as we go
                var localTokenIx = tokenIx + 1;
                // get to the first non-text token
                while (localTokenIx < len && tokens[localTokenIx].type === TokenTypes.TEXT) {
                    localTokenIx++;
                }
                // negate until we find a reason to stop
                while (localTokenIx < len) {
                    var localToken = tokens[localTokenIx];
                    if (localToken.type === TokenTypes.TEXT) {
                        break;
                    }
                    localToken.deselected = true;
                    localTokenIx++;
                }
            }
            // if we're dealing with an "or" we have two cases, we're either dealing with a negation
            // or a split. If this is a deselected or, we don't really need to do anything because that
            // means we just do a deselected join. If it's not negated though, we're now dealing with
            // a second query context. e.g. people who are employees or spouses of employees
            if (info.or && !token.deselected) {
                var localTokenIx = tokenIx + 1;
                // get to the first non-text token
                while (localTokenIx < len && tokens[localTokenIx].type === TokenTypes.TEXT) {
                    localTokenIx++;
                }
                // consume until we hit a separator
                while (localTokenIx < len) {
                    var localToken = tokens[localTokenIx];
                    if (localToken.type === TokenTypes.TEXT) {
                        break;
                    }
                    localTokenIx++;
                }
            }
            // a group adds a group for the next collection and checks to see if there's an and
            // or a separator that would indicate multiple groupings
            if (info.group) {
                // we're going to move forward from this token and deselect as we go
                var localTokenIx = tokenIx + 1;
                // get to the first non-text token
                while (localTokenIx < len && tokens[localTokenIx].type === TokenTypes.TEXT) {
                    localTokenIx++;
                }
                // if we've run out of tokens, bail
                if (localTokenIx === len)
                    break;
                // otherwise, the next thing we found is what we're trying to group by
                var localToken = tokens[localTokenIx];
                localToken.grouped = true;
                groups.push(localToken);
                localTokenIx++;
                // now we have to check if we're trying to group by multiple things, e.g.
                // "per department and age" or "per department, team, and age"
                var next = tokens[localTokenIx];
                while (next && next.type === TokenTypes.MODIFIER && (next.info.separator || next.info.and)) {
                    localTokenIx++;
                    next = tokens[localTokenIx];
                    // if we have another modifier directly after (e.g. ", and") loop again
                    // to see if this is valid.
                    if (next && next.type === TokenTypes.MODIFIER) {
                        continue;
                    }
                    next.grouped = true;
                    groups.push(next);
                    localTokenIx++;
                    next = tokens[localTokenIx];
                }
            }
            continue;
        }
        // deal with patterns
        if (type === TokenTypes.PATTERN) {
            if (info.type === "rewrite") {
                var newText = void 0;
                // if we only have one possible rewrite, we can just take it
                if (info.rewrites.length === 1) {
                    newText = info.rewrites[0].text;
                }
                else {
                    // @TODO: we have to go through every possibility and deal with it
                    newText = info.rewrites[0].text;
                }
                // Tokenize the new string.
                var newTokens = getTokens(newText);
                // Splice in the new tokens, adjust the length and make sure we revisit this token.
                len += newTokens.length;
                tokens.splice.apply(tokens, [tokenIx + 1, 0].concat(newTokens));
                // apply any deselects, or's, or and's to this token
                for (var _a = 0; _a < newTokens.length; _a++) {
                    var newToken = newTokens[_a];
                    newToken.deselected = token.deselected;
                    newToken.and = token.and;
                    newToken.or = token.or;
                }
                continue;
            }
            else {
                // otherwise it's an operation of some kind
                operations.push(token);
                // keep track of any other patterns we're trying to fill right now
                if (state.currentPattern) {
                    state.patternStack.push(state.currentPattern);
                }
                state.currentPattern = token;
                state.currentPattern.args = [];
            }
            if (info.infix) {
                state.currentPattern.args.push(indirectObject);
            }
            continue;
        }
        // deal with values
        if (type === TokenTypes.VALUE) {
            // Deal with a range value. It's really a pattern
            if (token.valueType === "range") {
                token.found = "between";
                token.info = patterns["between"];
                token.args = [];
                var start = { id: uuid(), found: token.start, orig: token.start, pos: token.pos, type: TokenTypes.VALUE, info: parseFloat(token.start), valueType: "number" };
                var stop = { id: uuid(), found: token.stop, orig: token.stop, pos: token.pos, type: TokenTypes.VALUE, info: parseFloat(token.stop), valueType: "number" };
                token.args.push(start);
                token.args.push(stop);
                operations.push(token);
                state.patternStack.push(token);
                if (state.currentPattern === null) {
                    state.currentPattern = state.patternStack.pop();
                }
                continue;
            }
            // if we still have a currentPattern to fill
            if (state.currentPattern && state.currentPattern.args.length < state.currentPattern.info.args.length) {
                state.currentPattern.args.push(token);
            }
            continue;
        }
        // We don't do anything with text nodes at this point
        if (type === TokenTypes.TEXT)
            continue;
        // once modifiers and patterns have been applied, we don't need to worry
        // about the directObject as it's already been assigned to the first root.
        if (directObject === token) {
            indirectObject = directObject;
            continue;
        }
        if (directObject === indirectObject) {
            directObject.children.push(token);
            token.relationship = determineRelationship(directObject, token);
            token.parent = directObject;
            indirectObject = token;
        }
        else {
            var potentialParent = indirectObject;
            // if our indirect object is an attribute and we encounter another one, we want to check
            // the parent of this node for a match
            if (indirectObject.type === TokenTypes.ATTRIBUTE && token.type === TokenTypes.ATTRIBUTE) {
                potentialParent = indirectObject.parent;
            }
            // if the indirect object is an attribute, anything other than another attribute will create
            // a new root
            if (indirectObject.type === TokenTypes.ATTRIBUTE && token.type !== TokenTypes.ATTRIBUTE) {
                var rootRel = determineRelationship(directObject, token);
                if (!rootRel || (rootRel.distance === 0 && token.type === TokenTypes.ENTITY)) {
                    indirectObject = token;
                    roots.push(indirectObject);
                }
                else {
                    directObject.children.push(token);
                    token.relationship = rootRel;
                    token.parent = directObject;
                }
            }
            else if (potentialParent.type === TokenTypes.ENTITY && token.type !== TokenTypes.ATTRIBUTE) {
                directObject.children.push(token);
                token.relationship = determineRelationship(directObject, token);
                token.parent = directObject;
                indirectObject = token;
            }
            else {
                var cursorRel = determineRelationship(potentialParent, token);
                var rootRel = determineRelationship(directObject, token);
                // if this token is an entity and either the directObject or indirectObject has a direct relationship
                // we don't really want to use that as it's most likely meant to filter a set down
                // instead of reduce the set to exactly one member.
                if (token.type === TokenTypes.ENTITY) {
                    if (cursorRel && cursorRel.distance === 0)
                        cursorRel = null;
                    if (rootRel && rootRel.distance === 0)
                        rootRel = null;
                }
                if (!cursorRel) {
                    directObject.children.push(token);
                    token.relationship = rootRel;
                    token.parent = directObject;
                }
                else if (!rootRel) {
                    potentialParent.children.push(token);
                    token.relationship = cursorRel;
                    token.parent = potentialParent;
                }
                else if (cursorRel.distance <= rootRel.distance) {
                    potentialParent.children.push(token);
                    token.relationship = cursorRel;
                    token.parent = potentialParent;
                }
                else {
                    // @TODO: maybe if there's a cursorRel we should just always ignore the rootRel even if it
                    // is a "better" relationship. Sentence structure-wise it seems pretty likely that attributes
                    // following an entity are related to that entity and not something else.
                    directObject.children.push(token);
                    token.relationship = rootRel;
                    token.parent = directObject;
                }
                indirectObject = token;
            }
        }
        // if we are still looking to fill in a pattern
        if (state.currentPattern) {
            var args = state.currentPattern.args;
            var infoArgs = state.currentPattern.info.args;
            var latestArg = args[args.length - 1];
            var latestArgComplete = !latestArg || latestArg.type === TokenTypes.ATTRIBUTE || latestArg.type === TokenTypes.VALUE;
            var firstArg = args[0];
            if (!latestArgComplete && indirectObject.type === TokenTypes.ATTRIBUTE) {
                args.pop();
                args.push(indirectObject);
            }
            else if (latestArgComplete && args.length < infoArgs.length) {
                args.push(indirectObject);
                latestArg = indirectObject;
            }
        }
    }
    // End main token loop
    // if we've run out of tokens and are still looking to fill in a pattern,
    // we might need to carry the attribute through.
    if (state.currentPattern && state.currentPattern.args.length <= state.currentPattern.info.args.length) {
        var args = state.currentPattern.args;
        var infoArgs = state.currentPattern.info.args;
        var latestArg = args[args.length - 1];
        if (!latestArg)
            return tree;
        var latestArgComplete = latestArg.type === TokenTypes.ATTRIBUTE || latestArg.type === TokenTypes.VALUE;
        var firstArg = args[0];
        // e.g. people older than chris granger => people age > chris granger age
        if (!latestArgComplete && firstArg && firstArg.type === TokenTypes.ATTRIBUTE) {
            var newArg = { type: firstArg.type, found: firstArg.found, orig: firstArg.orig, info: firstArg.info, id: uuid(), children: [] };
            var cursorRel = determineRelationship(latestArg, newArg);
            newArg.relationship = cursorRel;
            newArg.parent = latestArg;
            latestArg.children.push(newArg);
            args.pop();
            args.push(newArg);
        }
        else if (state.currentPattern.found === "between") {
            // Backtrack from the pattern start until we find an attribute
            var patternStart = tokens.lastIndexOf(state.currentPattern);
            var arg = null;
            for (var ix = patternStart; ix > 0; ix--) {
                if (tokens[ix].type === TokenTypes.ATTRIBUTE) {
                    arg = tokens[ix];
                    break;
                }
            }
            // If we found an attribute, now add it to the arglist for the pattern
            if (arg != null) {
                state.currentPattern.args.push(arg);
            }
        }
    }
    return tree;
}
// ---------------------------------------------------------
// Query plans
// ---------------------------------------------------------
(function (StepType) {
    StepType[StepType["FIND"] = 0] = "FIND";
    StepType[StepType["GATHER"] = 1] = "GATHER";
    StepType[StepType["LOOKUP"] = 2] = "LOOKUP";
    StepType[StepType["FILTERBYENTITY"] = 3] = "FILTERBYENTITY";
    StepType[StepType["INTERSECT"] = 4] = "INTERSECT";
    StepType[StepType["CALCULATE"] = 5] = "CALCULATE";
    StepType[StepType["AGGREGATE"] = 6] = "AGGREGATE";
    StepType[StepType["FILTER"] = 7] = "FILTER";
    StepType[StepType["SORT"] = 8] = "SORT";
    StepType[StepType["LIMIT"] = 9] = "LIMIT";
    StepType[StepType["GROUP"] = 10] = "GROUP";
})(exports.StepType || (exports.StepType = {}));
var StepType = exports.StepType;
function queryToPlan(query) {
    var tokens = getTokens(query);
    var tree = tokensToTree(tokens);
    var plan = treeToPlan(tree);
    return { tokens: tokens, tree: tree, plan: plan };
}
exports.queryToPlan = queryToPlan;
var Plan = (function (_super) {
    __extends(Plan, _super);
    function Plan() {
        _super.apply(this, arguments);
    }
    return Plan;
})(Array);
exports.Plan = Plan;
(function (Validated) {
    Validated[Validated["INVALID"] = 0] = "INVALID";
    Validated[Validated["VALID"] = 1] = "VALID";
    Validated[Validated["UNVALIDATED"] = 2] = "UNVALIDATED";
})(exports.Validated || (exports.Validated = {}));
var Validated = exports.Validated;
function ignoreHiddenCollections(colls) {
    for (var _i = 0; _i < colls.length; _i++) {
        var coll = colls[_i];
        if (coll !== "generic related to") {
            return coll;
        }
    }
}
function nodeToPlanSteps(node, parent, parentPlan) {
    // TODO: figure out what to do with operations
    var id = node.id || uuid();
    var deselected = node.deselected;
    var rel = node.relationship;
    var plan = [];
    var curParent = parentPlan;
    if (parent && rel) {
        switch (rel.type) {
            case RelationshipTypes.COLLECTION_ATTRIBUTE:
                for (var _i = 0, _a = rel.nodes; _i < _a.length; _i++) {
                    var node_1 = _a[_i];
                    var coll = ignoreHiddenCollections(node_1);
                    var item = { type: StepType.GATHER, relatedTo: curParent, subject: coll, id: uuid() };
                    plan.push(item);
                    curParent = item;
                }
                plan.push({ type: StepType.LOOKUP, relatedTo: curParent, subject: node.found, id: id, deselected: deselected });
                return plan;
                break;
            case RelationshipTypes.COLLECTION_ENTITY:
                for (var _b = 0, _c = rel.nodes; _b < _c.length; _b++) {
                    var node_2 = _c[_b];
                    var coll = ignoreHiddenCollections(node_2);
                    var item = { type: StepType.GATHER, relatedTo: curParent, subject: coll, id: uuid() };
                    plan.push(item);
                    curParent = item;
                }
                plan.push({ type: StepType.FILTERBYENTITY, relatedTo: curParent, subject: node.found, id: id, deselected: deselected });
                return plan;
                break;
            case RelationshipTypes.COLLECTION_COLLECTION:
                return [{ type: StepType.GATHER, relatedTo: parentPlan, subject: node.found, id: id, deselected: deselected }];
                break;
            case RelationshipTypes.COLLECTION_INTERSECTION:
                return [{ type: StepType.INTERSECT, relatedTo: parentPlan, subject: node.found, id: id, deselected: deselected }];
                break;
            case RelationshipTypes.ENTITY_ATTRIBUTE:
                if (rel.distance === 0) {
                    return [{ type: StepType.LOOKUP, relatedTo: parentPlan, subject: node.found, id: id, deselected: deselected }];
                }
                else {
                    var plan_1 = [];
                    var curParent_1 = parentPlan;
                    for (var _d = 0, _e = rel.nodes; _d < _e.length; _d++) {
                        var node_3 = _e[_d];
                        var coll = ignoreHiddenCollections(node_3);
                        var item = { type: StepType.GATHER, relatedTo: curParent_1, subject: coll, id: uuid() };
                        plan_1.push(item);
                        curParent_1 = item;
                    }
                    plan_1.push({ type: StepType.LOOKUP, relatedTo: curParent_1, subject: node.found, id: id, deselected: deselected });
                    return plan_1;
                }
                break;
        }
    }
    else {
        if (node.type === TokenTypes.COLLECTION) {
            return [{ type: StepType.GATHER, subject: node.found, id: id, deselected: deselected }];
        }
        else if (node.type === TokenTypes.ENTITY) {
            return [{ type: StepType.FIND, subject: node.found, id: id, deselected: deselected }];
        }
        else if (node.type === TokenTypes.ATTRIBUTE) {
            return [{ type: StepType.LOOKUP, subject: node.found, id: id, deselected: deselected }];
        }
        return [];
    }
}
function nodeToPlan(tree, parent, parentPlan) {
    if (parent === void 0) { parent = null; }
    if (parentPlan === void 0) { parentPlan = null; }
    if (!tree)
        return [];
    var plan = [];
    // process you, then your children
    plan.push.apply(plan, nodeToPlanSteps(tree, parent, parentPlan));
    var neueParentPlan = plan[plan.length - 1];
    for (var _i = 0, _a = tree.children; _i < _a.length; _i++) {
        var child = _a[_i];
        plan.push.apply(plan, nodeToPlan(child, tree, neueParentPlan));
    }
    return plan;
}
/*enum PatternTypes {
  COLLECTION,
  ENTITY,
  ATTRIBUTE,
  VALUE,
  GROUP,
  AGGREGATE,
  SORTLIMIT,
  FILTER,
  REWRITE,
}*/
function groupsToPlan(nodes) {
    if (!nodes.length)
        return [];
    var groups = [];
    for (var _i = 0; _i < nodes.length; _i++) {
        var node = nodes[_i];
        if (node.type === "collection") {
            groups.push([node.id, "entity"]);
        }
        else if (node.type === "attribute") {
            groups.push([node.id, "value"]);
        }
        else {
            throw new Error("Invalid node to group on: " + JSON.stringify(nodes));
        }
    }
    return [{ type: StepType.GROUP, id: uuid(), groups: groups, groupNodes: nodes }];
}
function opToPlan(op, groups) {
    var info = op.info;
    var args = {};
    if (info.args) {
        var ix = 0;
        for (var _i = 0, _a = info.args; _i < _a.length; _i++) {
            var arg = _a[_i];
            var argValue = op.args[ix];
            if (argValue === undefined)
                continue;
            if (argValue.type === TokenTypes.VALUE) {
                args[arg] = argValue.found;
            }
            else if (argValue.type === TokenTypes.ATTRIBUTE) {
                args[arg] = [argValue.id, "value"];
            }
            else {
                console.error("Invalid operation argument: " + argValue.orig + " for " + op.found);
            }
            ix++;
        }
    }
    if (info.type === "aggregate") {
        return [{ type: StepType.AGGREGATE, subject: info.op, args: args, id: uuid(), argArray: op.args }];
    }
    else if (info.type === "sort and limit") {
        var sortLimitArgs = op.args.map(function (arg) { return arg.found; });
        var sortField = { parentId: op.args[1].id, parent: op.args[1].parent.found, subject: op.args[1].found };
        var subject = "results";
        // If groups are formed, check if we are sorting on one of them
        for (var _b = 0; _b < groups.length; _b++) {
            var group = groups[_b];
            if (group.found === sortField.parent) {
                subject = "per group";
                break;
            }
        }
        var sortStep = { type: StepType.SORT, subject: subject, direction: info.direction, field: sortField, id: uuid() };
        var limitStep = { type: StepType.LIMIT, subject: subject, value: sortLimitArgs[0], id: uuid() };
        return [sortStep, limitStep];
    }
    else if (info.type === "bounds") {
        var lowerBounds = { type: StepType.FILTER, subject: ">", id: uuid(), argArray: [op.args[2], op.args[0]] };
        var upperBounds = { type: StepType.FILTER, subject: "<", id: uuid(), argArray: [op.args[2], op.args[1]] };
        return [lowerBounds, upperBounds];
    }
    else if (info.type === "filter") {
        return [{ type: StepType.FILTER, subject: info.op, args: args, id: uuid(), argArray: op.args }];
    }
    else {
        return [{ type: StepType.CALCULATE, subject: info.op, args: args, id: uuid(), argArray: op.args }];
    }
}
// Since intermediate plan steps can end up duplicated, we need to walk the plan to find
// nodes that are exactly the same and only do them once. E.g. salaries per department and age
// will bring in two employee gathers.
function dedupePlan(plan) {
    var dupes = {};
    // for every node in the plan backwards
    for (var planIx = plan.length - 1; planIx > -1; planIx--) {
        var step = plan[planIx];
        // check all preceding nodes for a node that is equivalent
        for (var dupeIx = planIx - 1; dupeIx > -1; dupeIx--) {
            var dupe = plan[dupeIx];
            // equivalency requires the same type, subject, deselect, and parent
            if (step.type === dupe.type && step.subject === dupe.subject && step.deselected === dupe.deselected && step.relatedTo === dupe.relatedTo) {
                // store the dupe and what node will replace it
                dupes[step.id] = dupe.id;
            }
        }
    }
    return plan.filter(function (step) {
        // remove anything we found to be a dupe
        if (dupes[step.id])
            return false;
        // if this step references a dupe, relate it to the new node
        if (dupes[step.relatedTo]) {
            step.relatedTo = dupes[step.relatedTo];
        }
        return true;
    });
}
function treeToPlan(tree) {
    var steps = [];
    for (var _i = 0, _a = tree.roots; _i < _a.length; _i++) {
        var root = _a[_i];
        steps = steps.concat(nodeToPlan(root));
    }
    steps = dedupePlan(steps);
    for (var _b = 0, _c = tree.groups; _b < _c.length; _b++) {
        var group = _c[_b];
        var node = void 0;
        for (var _d = 0; _d < steps.length; _d++) {
            var step = steps[_d];
            if (step.id === group.id) {
                node = step;
                break;
            }
        }
        steps.push({ id: uuid(), type: StepType.GROUP, subject: group.found, subjectNode: node });
    }
    for (var _e = 0, _f = tree.operations; _e < _f.length; _e++) {
        var op = _f[_e];
        steps = steps.concat(opToPlan(op, tree.groups));
    }
    // Create a plan type for return
    var plan = new Plan();
    plan.valid = Validated.INVALID;
    for (var _g = 0; _g < steps.length; _g++) {
        var step = steps[_g];
        plan.push(step);
    }
    return plan;
}
// ---------------------------------------------------------
// Plan to query
// ---------------------------------------------------------
function safeProjectionName(name, projection) {
    if (!projection[name]) {
        return name;
    }
    var ix = 2;
    while (projection[name]) {
        name = name + " " + ix;
        ix++;
    }
    return name;
}
function planToExecutable(plan) {
    var projection = {};
    var query = app_1.eve.query();
    for (var _i = 0; _i < plan.length; _i++) {
        var step = plan[_i];
        switch (step.type) {
            case StepType.FIND:
                // find is a no-op
                step.size = 0;
                break;
            case StepType.GATHER:
                var join = {};
                if (step.subject) {
                    join.collection = step.subject;
                }
                var related = step.relatedTo;
                if (related) {
                    if (related.type === StepType.FIND) {
                        step.size = 2;
                        var linkId_1 = step.id + " | link";
                        query.select("directionless links", { entity: related.subject }, linkId_1);
                        join.entity = [linkId_1, "link"];
                        query.select("collection entities", join, step.id);
                    }
                    else {
                        step.size = 2;
                        var linkId_2 = step.id + " | link";
                        query.select("directionless links", { entity: [related.id, "entity"] }, linkId_2);
                        join.entity = [linkId_2, "link"];
                        query.select("collection entities", join, step.id);
                    }
                }
                else {
                    step.size = 1;
                    query.select("collection entities", join, step.id);
                }
                step.name = safeProjectionName(step.subject, projection);
                projection[step.name] = [step.id, "entity"];
                break;
            case StepType.LOOKUP:
                var join = { attribute: step.subject };
                var related = step.relatedTo;
                if (related) {
                    if (related.type === StepType.FIND) {
                        join.entity = related.subject;
                    }
                    else {
                        join.entity = [related.id, "entity"];
                    }
                }
                if (step.deselected) {
                    step.size = 0;
                    query.deselect("entity eavs", join);
                }
                else {
                    step.size = 1;
                    query.select("entity eavs", join, step.id);
                    step.name = safeProjectionName(step.subject, projection);
                    projection[step.name] = [step.id, "value"];
                }
                break;
            case StepType.INTERSECT:
                var related = step.relatedTo;
                if (step.deselected) {
                    step.size = 0;
                    query.deselect("collection entities", { collection: step.subject, entity: [related.id, "entity"] });
                }
                else {
                    step.size = 1;
                    query.select("collection entities", { collection: step.subject, entity: [related.id, "entity"] }, step.id);
                }
                break;
            case StepType.FILTERBYENTITY:
                var related = step.relatedTo;
                var linkId = step.id + " | link";
                if (step.deselected) {
                    step.size = 0;
                    query.deselect("directionless links", { entity: [related.id, "entity"], link: step.subject });
                }
                else {
                    step.size = 1;
                    query.select("directionless links", { entity: [related.id, "entity"], link: step.subject }, step.id);
                }
                break;
            case StepType.FILTER:
                step.size = 0;
                query.calculate(step.subject, step.args, step.id);
                break;
            case StepType.CALCULATE:
                step.size = 1;
                query.calculate(step.subject, step.args, step.id);
                step.name = safeProjectionName(step.subject, projection);
                projection[step.name] = [step.id, "result"];
                break;
            case StepType.AGGREGATE:
                step.size = 1;
                query.aggregate(step.subject, step.args, step.id);
                step.name = safeProjectionName(step.subject, projection);
                projection[step.name] = [step.id, step.subject];
                break;
            case StepType.GROUP:
                step.size = 0;
                var field = "entity";
                if (step.subjectNode.type === StepType.LOOKUP) {
                    field = "value";
                }
                step.name = step.subjectNode.name;
                query.group([step.subjectNode.id, field]);
                break;
            case StepType.SORT:
                step.size = 0;
                query.sort([step.field.parentId, "value", step.direction]);
                break;
            case StepType.LIMIT:
                step.size = 0;
                query.limit(step.limit);
                break;
        }
    }
    query.project(projection);
    return query;
}
exports.planToExecutable = planToExecutable;
function queryToExecutable(query) {
    var planInfo = queryToPlan(query);
    var executable = planToExecutable(planInfo.plan);
    planInfo.executable = executable;
    planInfo.queryString = query;
    return planInfo;
}
exports.queryToExecutable = queryToExecutable;
// ---------------------------------------------------------
// Utils
// ---------------------------------------------------------
function arrayIntersect(a, b) {
    var ai = 0;
    var bi = 0;
    var result = [];
    while (ai < a.length && bi < b.length) {
        if (a[ai] < b[bi])
            ai++;
        else if (a[ai] > b[bi])
            bi++;
        else {
            result.push(a[ai]);
            ai++;
            bi++;
        }
    }
    return result;
}
window["queryParser"] = exports;
var _a, _b, _c;
//# sourceMappingURL=queryParser.js.map