var app_1 = require("./app");
(function (StateFlags) {
    StateFlags[StateFlags["COMPLETE"] = 0] = "COMPLETE";
    StateFlags[StateFlags["MOREINFO"] = 1] = "MOREINFO";
    StateFlags[StateFlags["NORESULT"] = 2] = "NORESULT";
})(exports.StateFlags || (exports.StateFlags = {}));
var StateFlags = exports.StateFlags;
// Entry point for NLQP
function parse(queryString) {
    var preTokens = preprocessQueryString(queryString);
    var tokens = formTokens(preTokens);
    var _a = formTree(tokens), tree = _a.tree, context = _a.context;
    var query = formQuery(tree);
    // Figure out the state flags
    var flag;
    if (query.projects.length === 0 && query.terms.length === 0) {
        flag = StateFlags.NORESULT;
    }
    else if (treeComplete(tree)) {
        flag = StateFlags.COMPLETE;
    }
    else {
        flag = StateFlags.MOREINFO;
    }
    return [{ tokens: tokens, tree: tree, context: context, query: query, score: undefined, state: flag }];
}
exports.parse = parse;
// Returns false if any nodes are not marked found
// Returns true if all nodes are marked found
function treeComplete(node) {
    if (node.found === false) {
        return false;
    }
    else {
        var childrenStatus = node.children.map(treeComplete);
        return childrenStatus.every(function (child) { return child === true; });
    }
}
// Performs some transformations to the query string before tokenizing
function preprocessQueryString(queryString) {
    // Add whitespace before commas
    var processedString = queryString.replace(new RegExp(",", 'g'), " , ");
    processedString = processedString.replace(new RegExp(";", 'g'), " ; ");
    processedString = processedString.replace(new RegExp("\\+", 'g'), " + ");
    processedString = processedString.replace(new RegExp("-", 'g'), " - ");
    processedString = processedString.replace(new RegExp("\\*", 'g'), " * ");
    processedString = processedString.replace(new RegExp("/", 'g'), " / ");
    processedString = processedString.replace(new RegExp("\s\s+", 'g'), " ");
    // Get parts of speach with sentence information. It's okay if they're wrong; they 
    // will be corrected as we create the tree and match against the underlying data model
    var sentences = nlp.pos(processedString, { dont_combine: true }).sentences;
    // If no sentences were found, don't bother parsing
    if (sentences.length === 0) {
        return [];
    }
    var nlpcTokens = sentences[0].tokens;
    var preTokens = nlpcTokens.map(function (token, i) {
        return { ix: i, text: token.text, tag: token.pos.tag };
    });
    // Group quoted text here
    var quoteStarts = preTokens.filter(function (t) { return t.text.charAt(0) === "\""; });
    var quoteEnds = preTokens.filter(function (t) { return t.text.charAt(t.text.length - 1) === "\""; });
    // If we have balanced quotes, combine tokens
    if (quoteStarts.length === quoteEnds.length) {
        var end, start; // @HACK to get around block scoped variable restriction
        for (var i = 0; i < quoteStarts.length; i++) {
            start = quoteStarts[i];
            end = quoteEnds[i];
            // Get all tokens between quotes (inclusive)
            var quotedTokens = preTokens.filter(function (token) { return token.ix >= start.ix && token.ix <= end.ix; })
                .map(function (token) { return token.text; });
            var quotedText = quotedTokens.join(" ");
            // Remove quotes                           
            quotedText = quotedText.replace(new RegExp("\"", 'g'), "");
            // Create a new pretoken
            var newPreToken = { ix: start.ix, text: quotedText, tag: "NNQ" };
            preTokens.splice(preTokens.indexOf(start), quotedTokens.length, newPreToken);
        }
    }
    return preTokens;
}
exports.preprocessQueryString = preprocessQueryString;
var MajorPartsOfSpeech;
(function (MajorPartsOfSpeech) {
    MajorPartsOfSpeech[MajorPartsOfSpeech["ROOT"] = 0] = "ROOT";
    MajorPartsOfSpeech[MajorPartsOfSpeech["VERB"] = 1] = "VERB";
    MajorPartsOfSpeech[MajorPartsOfSpeech["ADJECTIVE"] = 2] = "ADJECTIVE";
    MajorPartsOfSpeech[MajorPartsOfSpeech["ADVERB"] = 3] = "ADVERB";
    MajorPartsOfSpeech[MajorPartsOfSpeech["NOUN"] = 4] = "NOUN";
    MajorPartsOfSpeech[MajorPartsOfSpeech["GLUE"] = 5] = "GLUE";
    MajorPartsOfSpeech[MajorPartsOfSpeech["WHWORD"] = 6] = "WHWORD";
    MajorPartsOfSpeech[MajorPartsOfSpeech["SYMBOL"] = 7] = "SYMBOL";
})(MajorPartsOfSpeech || (MajorPartsOfSpeech = {}));
var MinorPartsOfSpeech;
(function (MinorPartsOfSpeech) {
    MinorPartsOfSpeech[MinorPartsOfSpeech["ROOT"] = 0] = "ROOT";
    // Verb
    MinorPartsOfSpeech[MinorPartsOfSpeech["VB"] = 1] = "VB";
    MinorPartsOfSpeech[MinorPartsOfSpeech["VBD"] = 2] = "VBD";
    MinorPartsOfSpeech[MinorPartsOfSpeech["VBN"] = 3] = "VBN";
    MinorPartsOfSpeech[MinorPartsOfSpeech["VBP"] = 4] = "VBP";
    MinorPartsOfSpeech[MinorPartsOfSpeech["VBZ"] = 5] = "VBZ";
    MinorPartsOfSpeech[MinorPartsOfSpeech["VBF"] = 6] = "VBF";
    MinorPartsOfSpeech[MinorPartsOfSpeech["CP"] = 7] = "CP";
    MinorPartsOfSpeech[MinorPartsOfSpeech["VBG"] = 8] = "VBG";
    // Adjective
    MinorPartsOfSpeech[MinorPartsOfSpeech["JJ"] = 9] = "JJ";
    MinorPartsOfSpeech[MinorPartsOfSpeech["JJR"] = 10] = "JJR";
    MinorPartsOfSpeech[MinorPartsOfSpeech["JJS"] = 11] = "JJS";
    // Adverb
    MinorPartsOfSpeech[MinorPartsOfSpeech["RB"] = 12] = "RB";
    MinorPartsOfSpeech[MinorPartsOfSpeech["RBR"] = 13] = "RBR";
    MinorPartsOfSpeech[MinorPartsOfSpeech["RBS"] = 14] = "RBS";
    // Noun
    MinorPartsOfSpeech[MinorPartsOfSpeech["NN"] = 15] = "NN";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NNPA"] = 16] = "NNPA";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NNAB"] = 17] = "NNAB";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NG"] = 18] = "NG";
    MinorPartsOfSpeech[MinorPartsOfSpeech["PRP"] = 19] = "PRP";
    MinorPartsOfSpeech[MinorPartsOfSpeech["PP"] = 20] = "PP";
    // Legacy Noun
    MinorPartsOfSpeech[MinorPartsOfSpeech["NNP"] = 21] = "NNP";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NNPS"] = 22] = "NNPS";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NNO"] = 23] = "NNO";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NNS"] = 24] = "NNS";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NNA"] = 25] = "NNA";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NNQ"] = 26] = "NNQ";
    // Glue
    MinorPartsOfSpeech[MinorPartsOfSpeech["FW"] = 27] = "FW";
    MinorPartsOfSpeech[MinorPartsOfSpeech["IN"] = 28] = "IN";
    MinorPartsOfSpeech[MinorPartsOfSpeech["MD"] = 29] = "MD";
    MinorPartsOfSpeech[MinorPartsOfSpeech["CC"] = 30] = "CC";
    MinorPartsOfSpeech[MinorPartsOfSpeech["PDT"] = 31] = "PDT";
    MinorPartsOfSpeech[MinorPartsOfSpeech["DT"] = 32] = "DT";
    MinorPartsOfSpeech[MinorPartsOfSpeech["UH"] = 33] = "UH";
    MinorPartsOfSpeech[MinorPartsOfSpeech["EX"] = 34] = "EX";
    // Value
    MinorPartsOfSpeech[MinorPartsOfSpeech["CD"] = 35] = "CD";
    MinorPartsOfSpeech[MinorPartsOfSpeech["DA"] = 36] = "DA";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NU"] = 37] = "NU";
    // Symbol
    MinorPartsOfSpeech[MinorPartsOfSpeech["LT"] = 38] = "LT";
    MinorPartsOfSpeech[MinorPartsOfSpeech["GT"] = 39] = "GT";
    MinorPartsOfSpeech[MinorPartsOfSpeech["GTE"] = 40] = "GTE";
    MinorPartsOfSpeech[MinorPartsOfSpeech["LTE"] = 41] = "LTE";
    MinorPartsOfSpeech[MinorPartsOfSpeech["EQ"] = 42] = "EQ";
    MinorPartsOfSpeech[MinorPartsOfSpeech["NEQ"] = 43] = "NEQ";
    MinorPartsOfSpeech[MinorPartsOfSpeech["PLUS"] = 44] = "PLUS";
    MinorPartsOfSpeech[MinorPartsOfSpeech["MINUS"] = 45] = "MINUS";
    MinorPartsOfSpeech[MinorPartsOfSpeech["DIV"] = 46] = "DIV";
    MinorPartsOfSpeech[MinorPartsOfSpeech["MUL"] = 47] = "MUL";
    MinorPartsOfSpeech[MinorPartsOfSpeech["SEP"] = 48] = "SEP";
    // Wh- word
    MinorPartsOfSpeech[MinorPartsOfSpeech["WDT"] = 49] = "WDT";
    MinorPartsOfSpeech[MinorPartsOfSpeech["WP"] = 50] = "WP";
    MinorPartsOfSpeech[MinorPartsOfSpeech["WPO"] = 51] = "WPO";
    MinorPartsOfSpeech[MinorPartsOfSpeech["WRB"] = 52] = "WRB"; // Wh-adverb (however whenever where why)
})(MinorPartsOfSpeech || (MinorPartsOfSpeech = {}));
function cloneToken(token) {
    var clone = {
        ix: token.ix,
        originalWord: token.originalWord,
        normalizedWord: token.normalizedWord,
        POS: token.POS,
        properties: [],
    };
    token.properties.map(function (property) { return clone.properties.push(property); });
    return clone;
}
function newToken(word) {
    var token = {
        ix: 0,
        originalWord: word,
        normalizedWord: word,
        POS: MinorPartsOfSpeech.NN,
        properties: [],
    };
    return token;
}
var Properties;
(function (Properties) {
    Properties[Properties["ROOT"] = 0] = "ROOT";
    Properties[Properties["ENTITY"] = 1] = "ENTITY";
    Properties[Properties["COLLECTION"] = 2] = "COLLECTION";
    Properties[Properties["ATTRIBUTE"] = 3] = "ATTRIBUTE";
    Properties[Properties["QUANTITY"] = 4] = "QUANTITY";
    Properties[Properties["PROPER"] = 5] = "PROPER";
    Properties[Properties["PLURAL"] = 6] = "PLURAL";
    Properties[Properties["POSSESSIVE"] = 7] = "POSSESSIVE";
    Properties[Properties["BACKRELATIONSHIP"] = 8] = "BACKRELATIONSHIP";
    Properties[Properties["COMPARATIVE"] = 9] = "COMPARATIVE";
    Properties[Properties["SUPERLATIVE"] = 10] = "SUPERLATIVE";
    Properties[Properties["PRONOUN"] = 11] = "PRONOUN";
    Properties[Properties["SEPARATOR"] = 12] = "SEPARATOR";
    Properties[Properties["CONJUNCTION"] = 13] = "CONJUNCTION";
    Properties[Properties["COMPOUND"] = 14] = "COMPOUND";
    Properties[Properties["QUOTED"] = 15] = "QUOTED";
    Properties[Properties["FUNCTION"] = 16] = "FUNCTION";
    Properties[Properties["GROUPING"] = 17] = "GROUPING";
    Properties[Properties["OUTPUT"] = 18] = "OUTPUT";
    Properties[Properties["NEGATES"] = 19] = "NEGATES";
    Properties[Properties["IMPLICIT"] = 20] = "IMPLICIT";
    Properties[Properties["AGGREGATE"] = 21] = "AGGREGATE";
    Properties[Properties["CALCULATE"] = 22] = "CALCULATE";
    Properties[Properties["OPERATOR"] = 23] = "OPERATOR";
})(Properties || (Properties = {}));
// Finds a given property in a token
function hasProperty(token, property) {
    var found = token.properties.indexOf(property);
    if (found !== -1) {
        return true;
    }
    else {
        return false;
    }
}
// take an input string, extract tokens
function formTokens(preTokens) {
    // Form a token for each word
    var cursorPos = -2;
    var tokens = preTokens.map(function (preToken, i) {
        var word = preToken.text;
        var tag = preToken.tag;
        var token = {
            ix: i + 1,
            originalWord: word,
            normalizedWord: word,
            start: cursorPos += 2,
            end: cursorPos += word.length - 1,
            POS: MinorPartsOfSpeech[tag],
            properties: [],
        };
        var before = "";
        // Add default attribute markers to nouns
        if (getMajorPOS(token.POS) === MajorPartsOfSpeech.NOUN) {
            if (token.POS === MinorPartsOfSpeech.NNO ||
                token.POS === MinorPartsOfSpeech.PP) {
                token.properties.push(Properties.POSSESSIVE);
            }
            if (token.POS === MinorPartsOfSpeech.NNP ||
                token.POS === MinorPartsOfSpeech.NNPS ||
                token.POS === MinorPartsOfSpeech.NNPA) {
                token.properties.push(Properties.PROPER);
            }
            if (token.POS === MinorPartsOfSpeech.NNPS ||
                token.POS === MinorPartsOfSpeech.NNS) {
                token.properties.push(Properties.PLURAL);
            }
            if (token.POS === MinorPartsOfSpeech.CD ||
                token.POS === MinorPartsOfSpeech.DA ||
                token.POS === MinorPartsOfSpeech.NU) {
                token.properties.push(Properties.QUANTITY);
            }
            if (token.POS === MinorPartsOfSpeech.PP ||
                token.POS === MinorPartsOfSpeech.PRP) {
                token.properties.push(Properties.PRONOUN);
            }
            if (token.POS === MinorPartsOfSpeech.NNQ) {
                token.properties.push(Properties.PROPER);
                token.properties.push(Properties.QUOTED);
            }
        }
        // Add default properties to adjectives and adverbs
        if (token.POS === MinorPartsOfSpeech.JJR || token.POS === MinorPartsOfSpeech.RBR) {
            token.properties.push(Properties.COMPARATIVE);
        }
        else if (token.POS === MinorPartsOfSpeech.JJS || token.POS === MinorPartsOfSpeech.RBS) {
            token.properties.push(Properties.SUPERLATIVE);
        }
        // Add default properties to separators
        if (token.POS === MinorPartsOfSpeech.CC) {
            token.properties.push(Properties.CONJUNCTION);
        }
        // normalize the word with the following transformations: 
        // --- strip punctuation
        // --- get rid of possessive ending 
        // --- convert to lower case
        // --- singularize
        // If the word is quoted
        if (token.POS === MinorPartsOfSpeech.NNQ ||
            token.POS === MinorPartsOfSpeech.CD) {
            token.normalizedWord = word;
        }
        else {
            var normalizedWord = word;
            // --- strip punctuation
            normalizedWord = normalizedWord.replace(/\.|\?|\!|/g, '');
            // --- get rid of possessive ending
            before = normalizedWord;
            normalizedWord = normalizedWord.replace(/'s|'$/, '');
            // Heuristic: If the word had a possessive ending, it has to be a possessive noun of some sort      
            if (before !== normalizedWord) {
                if (getMajorPOS(token.POS) !== MajorPartsOfSpeech.NOUN) {
                    token.POS = MinorPartsOfSpeech.NN;
                }
                token.properties.push(Properties.POSSESSIVE);
            }
            // --- convert to lowercase
            before = normalizedWord;
            normalizedWord = normalizedWord.toLowerCase();
            // Heuristic: if the word is not the first word in the sentence and it had capitalization, then it is probably a proper noun
            if (before !== normalizedWord && i !== 0) {
                token.POS = MinorPartsOfSpeech.NNP;
                token.properties.push(Properties.PROPER);
            }
            // --- if the word is a (not proper) noun or verb, singularize
            if ((getMajorPOS(token.POS) === MajorPartsOfSpeech.NOUN || getMajorPOS(token.POS) === MajorPartsOfSpeech.VERB) && !hasProperty(token, Properties.PROPER)) {
                before = normalizedWord;
                normalizedWord = singularize(normalizedWord);
                // Heuristic: If the word changed after singularizing it, then it was plural to begin with
                if (before !== normalizedWord) {
                    token.properties.push(Properties.PLURAL);
                }
            }
            token.normalizedWord = normalizedWord;
        }
        // Heuristic: Special case "in" classified as an adjective. e.g. "the in crowd". This is an uncommon usage
        if (token.normalizedWord === "in" && getMajorPOS(token.POS) === MajorPartsOfSpeech.ADJECTIVE) {
            token.POS = MinorPartsOfSpeech.IN;
        }
        // Heuristic: Special case words with no ambiguous POS that NLPC misclassifies
        switch (token.normalizedWord) {
            case "of":
                token.properties.push(Properties.BACKRELATIONSHIP);
                break;
            case "per":
                token.properties.push(Properties.BACKRELATIONSHIP);
                token.properties.push(Properties.GROUPING);
                break;
            case "all":
                token.POS = MinorPartsOfSpeech.PDT;
                break;
            case "had":
                token.POS = MinorPartsOfSpeech.VBD;
                break;
            case "has":
                token.POS = MinorPartsOfSpeech.VBZ;
                break;
            case "is":
                token.POS = MinorPartsOfSpeech.CP;
                break;
            case "was":
                token.POS = MinorPartsOfSpeech.CP;
                break;
            case "as":
                token.POS = MinorPartsOfSpeech.CP;
                break;
            case "were":
                token.POS = MinorPartsOfSpeech.CP;
                break;
            case "be":
                token.POS = MinorPartsOfSpeech.CP;
                break;
            case "do":
                token.POS = MinorPartsOfSpeech.VBP;
                break;
            case "no":
                token.properties.push(Properties.NEGATES);
                break;
            case "neither":
                token.POS = MinorPartsOfSpeech.CC;
                token.properties.push(Properties.NEGATES);
                break;
            case "nor":
                token.POS = MinorPartsOfSpeech.CC;
                token.properties.push(Properties.NEGATES);
                break;
            case "except":
                token.POS = MinorPartsOfSpeech.CC;
                token.properties.push(Properties.NEGATES);
                break;
            case "without":
                token.POS = MinorPartsOfSpeech.CC;
                token.properties.push(Properties.NEGATES);
                break;
            case "not":
                token.POS = MinorPartsOfSpeech.CC;
                token.properties.push(Properties.NEGATES);
                break;
            case "average":
                token.POS = MinorPartsOfSpeech.NN;
                break;
            case "mean":
                token.POS = MinorPartsOfSpeech.NN;
                break;
            case "their":
                token.properties.push(Properties.PLURAL);
                break;
            case "most":
                token.POS = MinorPartsOfSpeech.JJS;
                token.properties.push(Properties.SUPERLATIVE);
                break;
            case "best":
                token.POS = MinorPartsOfSpeech.JJS;
                token.properties.push(Properties.SUPERLATIVE);
                break;
            case "will":
                // 'will' can be a noun
                if (getMajorPOS(token.POS) !== MajorPartsOfSpeech.NOUN) {
                    token.POS = MinorPartsOfSpeech.MD;
                }
                break;
            case "years":
                token.POS = MinorPartsOfSpeech.NN;
                token.normalizedWord = "year";
                token.properties.push(Properties.PLURAL);
                break;
        }
        // Special case symbols
        switch (token.normalizedWord) {
            case ">":
                token.POS = MinorPartsOfSpeech.GT;
                token.properties.push(Properties.COMPARATIVE);
                break;
            case ">=":
                token.POS = MinorPartsOfSpeech.GTE;
                token.properties.push(Properties.COMPARATIVE);
                break;
            case "<":
                token.POS = MinorPartsOfSpeech.LT;
                token.properties.push(Properties.COMPARATIVE);
                break;
            case "<=":
                token.POS = MinorPartsOfSpeech.LTE;
                token.properties.push(Properties.COMPARATIVE);
                break;
            case "=":
                token.POS = MinorPartsOfSpeech.EQ;
                token.properties.push(Properties.COMPARATIVE);
                break;
            case "!=":
                token.POS = MinorPartsOfSpeech.NEQ;
                token.properties.push(Properties.COMPARATIVE);
                break;
            case "+":
                token.POS = MinorPartsOfSpeech.PLUS;
                token.properties.push(Properties.OPERATOR);
                break;
            case "-":
                token.POS = MinorPartsOfSpeech.MINUS;
                token.properties.push(Properties.OPERATOR);
                break;
            case "*":
                token.POS = MinorPartsOfSpeech.MUL;
                token.properties.push(Properties.OPERATOR);
                break;
            case "/":
                token.POS = MinorPartsOfSpeech.DIV;
                token.properties.push(Properties.OPERATOR);
                break;
            case ",":
                token.POS = MinorPartsOfSpeech.SEP;
                token.properties.push(Properties.SEPARATOR);
                break;
            case ";":
                token.POS = MinorPartsOfSpeech.SEP;
                token.properties.push(Properties.SEPARATOR);
                break;
        }
        token.properties = token.properties.filter(onlyUnique);
        return token;
    });
    // Correct wh- tokens
    for (var _i = 0; _i < tokens.length; _i++) {
        var token = tokens[_i];
        if (token.normalizedWord === "that" ||
            token.normalizedWord === "whatever" ||
            token.normalizedWord === "which") {
            // determiners become wh- determiners
            if (token.POS === MinorPartsOfSpeech.DT) {
                token.POS = MinorPartsOfSpeech.WDT;
            }
            else if (token.POS === MinorPartsOfSpeech.PRP || token.POS === MinorPartsOfSpeech.PP) {
                token.POS = MinorPartsOfSpeech.WP;
            }
            continue;
        }
        // who and whom are wh- pronouns
        if (token.normalizedWord === "who" ||
            token.normalizedWord === "what" ||
            token.normalizedWord === "whom") {
            token.POS = MinorPartsOfSpeech.WP;
            continue;
        }
        // whose is the only wh- possessive pronoun
        if (token.normalizedWord === "whose") {
            token.POS = MinorPartsOfSpeech.WPO;
            token.properties.push(Properties.POSSESSIVE);
            continue;
        }
        // adverbs become wh- adverbs
        if (token.normalizedWord === "how" ||
            token.normalizedWord === "when" ||
            token.normalizedWord === "however" ||
            token.normalizedWord === "whenever" ||
            token.normalizedWord === "where" ||
            token.normalizedWord === "why") {
            token.POS = MinorPartsOfSpeech.WRB;
            continue;
        }
    }
    // Sentence-level POS corrections
    // Heuristic: If there are no verbs in the sentence, there can be no adverbs. Turn them into adjectives
    var verbs = tokens.filter(function (token) { return getMajorPOS(token.POS) === MajorPartsOfSpeech.VERB; });
    if (verbs.length === 0) {
        var adverbs = tokens.filter(function (token) { return getMajorPOS(token.POS) === MajorPartsOfSpeech.ADVERB; });
        adverbs.map(function (adverb) { return adverbToAdjective(adverb); });
    }
    else {
        // Heuristic: Adverbs are located close to verbs
        // Get the distance from each adverb to the closest verb as a percentage of the length of the sentence.
        var adverbs = tokens.filter(function (token) { return getMajorPOS(token.POS) === MajorPartsOfSpeech.ADVERB; });
        adverbs.map(function (adverb) {
            var closestVerb = tokens.length;
            verbs.map(function (verb) {
                var dist = Math.abs(adverb.ix - verb.ix);
                if (dist < closestVerb) {
                    closestVerb = dist;
                }
            });
            var distRatio = closestVerb / tokens.length;
            // Threshold the distance an adverb can be from the verb
            // if it is too far, make it an adjective instead
            if (distRatio > .25) {
                adverbToAdjective(adverb);
            }
        });
    }
    var rootToken = {
        ix: 0,
        originalWord: tokens.map(function (token) { return token.originalWord; }).join(" "),
        normalizedWord: tokens.map(function (token) { return token.normalizedWord; }).join(" "),
        POS: MinorPartsOfSpeech.ROOT,
        properties: [Properties.ROOT],
    };
    tokens = [rootToken].concat(tokens);
    log(tokenArrayToString(tokens));
    return tokens;
}
function adverbToAdjective(token) {
    var word = token.normalizedWord;
    // Heuristic: Words that end in -est are superlative
    if (word.substr(word.length - 3, word.length) === "est") {
        token.POS = MinorPartsOfSpeech.JJS;
        token.properties.push(Properties.SUPERLATIVE);
    }
    else if (word.substr(word.length - 2, word.length) === "er") {
        token.POS = MinorPartsOfSpeech.JJR;
        token.properties.push(Properties.COMPARATIVE);
    }
    else {
        token.POS = MinorPartsOfSpeech.JJ;
    }
    return token;
}
function getMajorPOS(minorPartOfSpeech) {
    // ROOT
    if (minorPartOfSpeech === MinorPartsOfSpeech.ROOT) {
        return MajorPartsOfSpeech.ROOT;
    }
    // Verb
    if (minorPartOfSpeech === MinorPartsOfSpeech.VB ||
        minorPartOfSpeech === MinorPartsOfSpeech.VBD ||
        minorPartOfSpeech === MinorPartsOfSpeech.VBN ||
        minorPartOfSpeech === MinorPartsOfSpeech.VBP ||
        minorPartOfSpeech === MinorPartsOfSpeech.VBZ ||
        minorPartOfSpeech === MinorPartsOfSpeech.VBF ||
        minorPartOfSpeech === MinorPartsOfSpeech.VBG) {
        return MajorPartsOfSpeech.VERB;
    }
    // Adjective
    if (minorPartOfSpeech === MinorPartsOfSpeech.JJ ||
        minorPartOfSpeech === MinorPartsOfSpeech.JJR ||
        minorPartOfSpeech === MinorPartsOfSpeech.JJS) {
        return MajorPartsOfSpeech.ADJECTIVE;
    }
    // Adjverb
    if (minorPartOfSpeech === MinorPartsOfSpeech.RB ||
        minorPartOfSpeech === MinorPartsOfSpeech.RBR ||
        minorPartOfSpeech === MinorPartsOfSpeech.RBS) {
        return MajorPartsOfSpeech.ADVERB;
    }
    // Noun
    if (minorPartOfSpeech === MinorPartsOfSpeech.NN ||
        minorPartOfSpeech === MinorPartsOfSpeech.NNA ||
        minorPartOfSpeech === MinorPartsOfSpeech.NNPA ||
        minorPartOfSpeech === MinorPartsOfSpeech.NNAB ||
        minorPartOfSpeech === MinorPartsOfSpeech.NNP ||
        minorPartOfSpeech === MinorPartsOfSpeech.NNPS ||
        minorPartOfSpeech === MinorPartsOfSpeech.NNS ||
        minorPartOfSpeech === MinorPartsOfSpeech.NNQ ||
        minorPartOfSpeech === MinorPartsOfSpeech.CD ||
        minorPartOfSpeech === MinorPartsOfSpeech.DA ||
        minorPartOfSpeech === MinorPartsOfSpeech.NU ||
        minorPartOfSpeech === MinorPartsOfSpeech.NNO ||
        minorPartOfSpeech === MinorPartsOfSpeech.NG ||
        minorPartOfSpeech === MinorPartsOfSpeech.PRP ||
        minorPartOfSpeech === MinorPartsOfSpeech.PP) {
        return MajorPartsOfSpeech.NOUN;
    }
    // Glue
    if (minorPartOfSpeech === MinorPartsOfSpeech.FW ||
        minorPartOfSpeech === MinorPartsOfSpeech.IN ||
        minorPartOfSpeech === MinorPartsOfSpeech.CP ||
        minorPartOfSpeech === MinorPartsOfSpeech.MD ||
        minorPartOfSpeech === MinorPartsOfSpeech.CC ||
        minorPartOfSpeech === MinorPartsOfSpeech.PDT ||
        minorPartOfSpeech === MinorPartsOfSpeech.DT ||
        minorPartOfSpeech === MinorPartsOfSpeech.UH ||
        minorPartOfSpeech === MinorPartsOfSpeech.EX) {
        return MajorPartsOfSpeech.GLUE;
    }
    // Symbol
    if (minorPartOfSpeech === MinorPartsOfSpeech.LT ||
        minorPartOfSpeech === MinorPartsOfSpeech.GT ||
        minorPartOfSpeech === MinorPartsOfSpeech.SEP) {
        return MajorPartsOfSpeech.SYMBOL;
    }
    // Wh-Word
    if (minorPartOfSpeech === MinorPartsOfSpeech.WDT ||
        minorPartOfSpeech === MinorPartsOfSpeech.WP ||
        minorPartOfSpeech === MinorPartsOfSpeech.WPO ||
        minorPartOfSpeech === MinorPartsOfSpeech.WRB) {
        return MajorPartsOfSpeech.WHWORD;
    }
}
// Wrap pluralize to special case certain words it gets wrong
function singularize(word) {
    var specialCases = ["his", "times", "has", "downstairs", "united states", "its"];
    for (var _i = 0; _i < specialCases.length; _i++) {
        var specialCase = specialCases[_i];
        if (specialCase === word) {
            return word;
        }
    }
    return pluralize(word, 1);
}
function cloneNode(node) {
    var token = cloneToken(node.token);
    var cloneNode = newNode(token);
    cloneNode.entity = node.entity;
    cloneNode.collection = node.collection;
    cloneNode.attribute = node.attribute;
    cloneNode.fxn = node.fxn;
    cloneNode.found = node.found;
    node.properties.map(function (property) { return cloneNode.properties.push(property); });
    return cloneNode;
}
function newNode(token) {
    var node = {
        ix: token.ix,
        name: token.normalizedWord,
        parent: undefined,
        children: [],
        token: token,
        properties: token.properties,
        found: false,
        hasProperty: hasProperty,
        toString: nodeToString,
    };
    token.node = node;
    function hasProperty(property) {
        var found = node.properties.indexOf(property);
        if (found !== -1) {
            return true;
        }
        else {
            return false;
        }
    }
    function nodeToString(depth) {
        if (depth === undefined) {
            depth = 0;
        }
        var childrenStrings = node.children.map(function (childNode) { return childNode.toString(depth + 1); }).join("\n");
        var children = childrenStrings.length > 0 ? "\n" + childrenStrings : "";
        var indent = Array(depth + 1).join(" ");
        var index = node.ix === undefined ? "+ " : node.ix + ": ";
        var properties = node.properties.length === 0 ? "" : "(" + node.properties.map(function (property) { return Properties[property]; }).join("|") + ")";
        var attribute = node.attribute === undefined ? "" : "[" + node.attribute.variable + " (" + node.attribute.value + ")] ";
        var entity = node.entity === undefined ? "" : "[" + node.entity.displayName + "] ";
        var collection = node.collection === undefined ? "" : "[" + node.collection.displayName + "] ";
        var fxn = node.fxn === undefined ? "" : "[" + node.fxn.name + "] ";
        var negated = node.hasProperty(Properties.NEGATES) ? "!" : "";
        var found = node.found ? "*" : " ";
        var entityOrProperties = found === " " ? "" + properties : "" + negated + fxn + entity + collection + attribute;
        properties = properties.length === 2 ? "" : properties;
        var nodeString = "|" + found + indent + index + node.name + " " + entityOrProperties + children;
        return nodeString;
    }
    return node;
}
//------------------------------------
// Various node manipulation functions
//------------------------------------
// Removes the node and its children from the tree, 
// and makes it a child of the target node
function reroot(node, target) {
    node.parent.children.splice(node.parent.children.indexOf(node), 1);
    node.parent = target;
    target.children.push(node);
}
// Removes a node from the tree
// The node's children get added to its parent
// returns the node or undefined if the operation failed
function removeNode(node) {
    if (node.hasProperty(Properties.ROOT)) {
        return node;
    }
    if (node.parent === undefined && node.children.length === 0) {
        return node;
    }
    var parent = node.parent;
    var children = node.children;
    // Rewire
    parent.children = parent.children.concat(children);
    parent.children.sort(function (a, b) { return a.ix - b.ix; });
    children.map(function (child) { return child.parent = parent; });
    // Get rid of references on current node
    parent.children.splice(parent.children.indexOf(node), 1);
    node.parent = undefined;
    node.children = [];
    return node;
}
// Returns the first ancestor node that has been found
function previouslyMatched(node) {
    if (node.parent === undefined) {
        return undefined;
    }
    else if (node.parent.hasProperty(Properties.ENTITY) ||
        node.parent.hasProperty(Properties.ATTRIBUTE) ||
        node.parent.hasProperty(Properties.COLLECTION)) {
        return node.parent;
    }
    else {
        return previouslyMatched(node.parent);
    }
}
// Inserts a node after the target, moving all of the
// target's children to the node
// Before: [Target] -> [Children]
// After:  [Target] -> [Node] -> [Children]
function insertAfterNode(node, target) {
    node.parent = target;
    node.children = target.children;
    target.children.map(function (n) { return n.parent = node; });
    target.children = [node];
}
// Find all leaf nodes stemming from a given node
function findLeafNodes(node) {
    if (node.children.length === 0) {
        return [node];
    }
    else {
        var foundLeafs = node.children.map(findLeafNodes);
        var flatLeafs = flattenNestedArray(foundLeafs);
        return flatLeafs;
    }
}
/*function moveNode(node: Node, target: Node): void {
  if (node.hasProperty(Properties.ROOT)) {
    return;
  }
  let parent = node.parent;
  parent.children.splice(parent.children.indexOf(node),1);
  parent.children = parent.children.concat(node.children);
  node.children.map((child) => child.parent = parent);
  node.children = [];
  node.parent = target;
  target.children.push(node);
}*/
// Finds a parent node with the specified property, 
// returns undefined if no node was found
function findParentWithProperty(node, property) {
    if (node.hasProperty(Properties.ROOT)) {
        return undefined;
    }
    if (node.parent.hasProperty(property)) {
        return node.parent;
    }
    else {
        return findParentWithProperty(node.parent, property);
    }
}
// Finds a parent node with the specified POS, 
// returns undefined if no node was found
function findParentWithPOS(node, majorPOS) {
    if (getMajorPOS(node.token.POS) === MajorPartsOfSpeech.ROOT) {
        return undefined;
    }
    if (getMajorPOS(node.parent.token.POS) === majorPOS) {
        return node.parent;
    }
    else {
        return findParentWithPOS(node.parent, majorPOS);
    }
}
/*
// Sets node to be a sibling of its parent
// Before: [Grandparent] -> [Parent] -> [Node]
// After:  [Grandparent] -> [Parent]
//                       -> [Node]
function promoteNode(node: Node): void {
  if (node.parent.hasProperty(Properties.ROOT)) {
    return;
  }
  let newSibling = node.parent;
  let newParent = newSibling.parent;
  // Set parent
  node.parent = newParent;
  // Remove node from parent's children
  newSibling.children.splice(newSibling.children.indexOf(node),1);
  // Add node to new parent's children
  newParent.children.push(node);
}*/
// Makes the node's parent a child of the node.
// The node's grandparent is then the node's parent
// Before: [Grandparent] -> [Parent] -> [Node]
// After: [Grandparen] -> [Node] -> [Parent]
function makeParentChild(node) {
    var parent = node.parent;
    // Do not swap with root
    if (parent.hasProperty(Properties.ROOT)) {
        return;
    }
    // Set parents
    node.parent = parent.parent;
    parent.parent = node;
    // Remove node as a child from parent
    parent.children.splice(parent.children.indexOf(node), 1);
    // Set children
    node.children = node.children.concat(parent);
    node.parent.children.push(node);
    node.parent.children.splice(node.parent.children.indexOf(parent), 1);
}
// Swaps a node with its parent. The node's parent
// is then the parent's parent, and its child is the parent.
// The parent gets the node's children
function swapWithParent(node) {
    var parent = node.parent;
    var pparent = parent.parent;
    if (parent.hasProperty(Properties.ROOT)) {
        return;
    }
    parent.parent = node;
    parent.children = node.children;
    pparent.children.splice(pparent.children.indexOf(parent), 1);
    node.parent = pparent;
    node.children = [parent];
    pparent.children.push(node);
}
(function (FunctionTypes) {
    FunctionTypes[FunctionTypes["FILTER"] = 0] = "FILTER";
    FunctionTypes[FunctionTypes["AGGREGATE"] = 1] = "AGGREGATE";
    FunctionTypes[FunctionTypes["BOOLEAN"] = 2] = "BOOLEAN";
    FunctionTypes[FunctionTypes["CALCULATE"] = 3] = "CALCULATE";
})(exports.FunctionTypes || (exports.FunctionTypes = {}));
var FunctionTypes = exports.FunctionTypes;
function newContext() {
    return {
        entities: [],
        collections: [],
        attributes: [],
        fxns: [],
        groupings: [],
        maybeEntities: [],
        maybeAttributes: [],
        maybeCollections: [],
        maybeFunctions: [],
        maybeArguments: [],
    };
}
function wordToFunction(word) {
    switch (word) {
        case "taller":
            return { name: ">", type: FunctionTypes.FILTER, attribute: "height", fields: ["a", "b"], project: false };
        case "shorter":
            return { name: "<", type: FunctionTypes.FILTER, attribute: "length", fields: ["a", "b"], project: false };
        case "longer":
            return { name: ">", type: FunctionTypes.FILTER, attribute: "length", fields: ["a", "b"], project: false };
        case "younger":
            return { name: "<", type: FunctionTypes.FILTER, attribute: "age", fields: ["a", "b"], project: false };
        case "and":
            return { name: "and", type: FunctionTypes.BOOLEAN, fields: [], project: false };
        case "or":
            return { name: "or", type: FunctionTypes.BOOLEAN, fields: [], project: false };
        case "total":
        case "sum":
            return { name: "sum", type: FunctionTypes.AGGREGATE, fields: ["sum", "value"], project: true };
        case "average":
        case "avg":
        case "mean":
            return { name: "average", type: FunctionTypes.AGGREGATE, fields: ["average", "value"], project: true };
        case "plus":
        case "add":
        case "+":
            return { name: "+", type: FunctionTypes.CALCULATE, fields: ["result", "a", "b"], project: true };
        case "subtract":
        case "minus":
        case "-":
            return { name: "-", type: FunctionTypes.CALCULATE, fields: ["result", "a", "b"], project: true };
        case "times":
        case "multiply":
        case "multiplied":
        case "*":
            return { name: "*", type: FunctionTypes.CALCULATE, fields: ["result", "a", "b"], project: true };
        case "divide":
        case "divided":
        case "/":
            return { name: "/", type: FunctionTypes.CALCULATE, fields: ["result", "a", "b"], project: true };
        default:
            return undefined;
    }
}
function formTree(tokens) {
    var tree;
    var subsumedNodes = [];
    // Turn tokens into nodes
    var nodes = tokens.filter(function (token) { return token.node === undefined; }).map(newNode);
    // Do a quick pass to identify functions
    tokens.map(function (token) {
        var node = token.node;
        var fxn = wordToFunction(node.name);
        if (fxn !== undefined) {
            node.fxn = fxn;
            fxn.node = node;
            node.properties.push(Properties.FUNCTION);
            if (node.fxn.type === FunctionTypes.AGGREGATE) {
                node.properties.push(Properties.AGGREGATE);
            }
            else if (node.fxn.type === FunctionTypes.CALCULATE) {
                node.properties.push(Properties.CALCULATE);
            }
        }
    });
    // Link nodes end to end
    nodes.map(function (thisNode, i) {
        var nextNode = nodes[i + 1];
        if (nextNode !== undefined) {
            thisNode.children.push(nextNode);
            nextNode.parent = thisNode;
        }
    });
    // At this point we should only have a single root.
    nodes = nodes.filter(function (node) { return node.parent === undefined; });
    tree = nodes.pop();
    function resolveEntities(node, context) {
        var relationship;
        loop0: while (node !== undefined) {
            context.maybeAttributes = context.maybeAttributes.filter(function (maybeAttr) { return !maybeAttr.found; });
            log("------------------------------------------");
            log(node);
            // Skip certain nodes
            if (node.found ||
                node.hasProperty(Properties.ROOT)) {
                log("Skipping...");
                node.found = true;
                break;
            }
            // Remove certain nodes
            if (!node.hasProperty(Properties.FUNCTION)) {
                if (node.hasProperty(Properties.SEPARATOR) ||
                    getMajorPOS(node.token.POS) === MajorPartsOfSpeech.WHWORD ||
                    getMajorPOS(node.token.POS) === MajorPartsOfSpeech.GLUE) {
                    log("Removing node \"" + node.name + "\"");
                    node = node.children[0];
                    if (node !== undefined) {
                        var rNode = removeNode(node.parent);
                        if (rNode.hasProperty(Properties.GROUPING)) {
                            node.properties.push(Properties.GROUPING);
                        }
                        if (rNode.hasProperty(Properties.NEGATES)) {
                            node.properties.push(Properties.NEGATES);
                        }
                    }
                    continue;
                }
            }
            // Handle quantities
            if (node.hasProperty(Properties.QUANTITY)) {
                // Create an attribute for the quantity 
                var quantityAttribute = {
                    id: node.name,
                    displayName: node.name,
                    value: "" + node.name,
                    variable: "" + node.name,
                    node: node,
                    project: false,
                };
                node.attribute = quantityAttribute;
                node.properties.push(Properties.ATTRIBUTE);
                node.found = true;
                continue;
            }
            // Handle functions
            if (node.hasProperty(Properties.FUNCTION)) {
                log("Handling function...");
                // Handle comparative functions
                if (node.hasProperty(Properties.COMPARATIVE)) {
                    var attribute = node.fxn.attribute;
                    var compAttrToken = newToken(node.fxn.attribute);
                    compAttrToken.properties.push(Properties.IMPLICIT);
                    var compAttrNode = newNode(compAttrToken);
                    compAttrNode.fxn = node.fxn;
                    // Find a node for the LHS of the comaparison
                    var matchedNode_1 = previouslyMatched(node);
                    var compAttrNode1 = cloneNode(compAttrNode);
                    relationship = findRelationship(matchedNode_1, compAttrNode1, context);
                    if (relationship.type === RelationshipTypes.DIRECT) {
                        removeNode(matchedNode_1);
                        node.children.push(matchedNode_1);
                        matchedNode_1.children.push(compAttrNode1);
                        compAttrNode1.attribute.project = false;
                    }
                    // Push the RHS attribute onto the context and continue searching
                    context.maybeAttributes.push(compAttrNode);
                    node.found = true;
                }
                else if (node.hasProperty(Properties.AGGREGATE)) {
                    var outputToken = newToken("output");
                    var outputNode = newNode(outputToken);
                    outputNode.found = true;
                    outputNode.properties.push(Properties.IMPLICIT);
                    outputNode.properties.push(Properties.OUTPUT);
                    var outputAttribute = {
                        id: outputNode.name,
                        displayName: outputNode.name,
                        value: node.fxn.name + "|" + outputNode.name,
                        variable: node.fxn.name + "|" + outputNode.name,
                        node: outputNode,
                        project: true,
                    };
                    outputNode.attribute = outputAttribute;
                    node.children.push(outputNode);
                    node.found = true;
                }
                else if (node.hasProperty(Properties.CALCULATE)) {
                    // Create a result node
                    var resultToken = newToken(node.fxn.fields[0]);
                    var resultNode = newNode(resultToken);
                    resultNode.properties.push(Properties.OUTPUT);
                    resultNode.properties.push(Properties.IMPLICIT);
                    var resultAttribute = {
                        id: resultNode.name,
                        displayName: resultNode.name,
                        value: node.fxn.name + "|" + resultNode.name,
                        variable: node.fxn.name + "|" + resultNode.name,
                        node: resultNode,
                        project: true,
                    };
                    resultNode.attribute = resultAttribute;
                    node.children.push(resultNode);
                    resultNode.found = true;
                    // Push two argument nodes onto the context
                    var argumentToken = newToken("b");
                    var argumentNode = newNode(argumentToken);
                    argumentNode.properties.push(Properties.IMPLICIT);
                    argumentNode.fxn = node.fxn;
                    context.maybeArguments.push(argumentNode);
                    argumentToken = newToken("a");
                    argumentNode = newNode(argumentToken);
                    argumentNode.properties.push(Properties.IMPLICIT);
                    argumentNode.fxn = node.fxn;
                    context.maybeArguments.push(argumentNode);
                    // If we already found a numerical attribute, rewire it
                    var foundQuantity = findParentWithProperty(node, Properties.QUANTITY);
                    if (foundQuantity !== undefined) {
                        if (foundQuantity.parent.hasProperty(Properties.ENTITY)) {
                            var quantityEntity = foundQuantity.parent;
                            reroot(node, quantityEntity.parent);
                            reroot(quantityEntity, node);
                            context.maybeArguments.pop();
                            foundQuantity.attribute.project = false;
                            foundQuantity.attribute.entity.project = false;
                        }
                        else {
                            removeNode(foundQuantity);
                            node.children.push(foundQuantity);
                        }
                    }
                    node.found = true;
                }
                context.fxns.push(node.fxn);
                break;
            }
            // Handle pronouns
            if (node.hasProperty(Properties.PRONOUN)) {
                log("Matching pronoun with previous entity...");
                var matchedNode_2 = previouslyMatched(node);
                if (matchedNode_2 !== undefined) {
                    if (matchedNode_2.collection !== undefined) {
                        node.collection = matchedNode_2.collection;
                        node.properties.push(Properties.COLLECTION);
                        node.found = true;
                        log("Found: " + matchedNode_2.name);
                        break;
                    }
                    else if (matchedNode_2.entity !== undefined) {
                        node.entity = matchedNode_2.entity;
                        node.properties.push(Properties.ENTITY);
                        node.found = true;
                        log("Found: " + matchedNode_2.name);
                        break;
                    }
                }
            }
            // Find the relationship between parent and child nodes
            // Previously matched node
            var matchedNode = previouslyMatched(node);
            if (matchedNode !== undefined) {
                // Find relationship between previously matched node and this one
                if (matchedNode.hasProperty(Properties.POSSESSIVE)) {
                    if (matchedNode.hasProperty(Properties.ENTITY)) {
                        var found = findEntityAttribute(node, matchedNode.entity, context);
                        if (found === true) {
                            relationship = { type: RelationshipTypes.DIRECT };
                        }
                    }
                    else {
                        relationship = findRelationship(matchedNode, node, context);
                    }
                }
                else {
                    findCollectionOrEntity(node, context);
                    relationship = findRelationship(matchedNode, node, context);
                }
            }
            else {
                findCollectionOrEntity(node, context);
                for (var _i = 0, _a = context.maybeAttributes; _i < _a.length; _i++) {
                    var maybeAttr = _a[_i];
                    relationship = findRelationship(maybeAttr, node, context);
                    // Rewire found attributes
                    if (maybeAttr.found === true) {
                        removeNode(maybeAttr);
                        // If the attr was an implicit attribute derived from a function,
                        // move the node to be a child of the function and reroot the rest of the query
                        if (maybeAttr.hasProperty(Properties.IMPLICIT)) {
                            maybeAttr.attribute.project = false;
                            var thisNode = node;
                            node = node.children[0];
                            if (node !== undefined) {
                                reroot(node, findParentWithProperty(node, Properties.ROOT));
                            }
                            thisNode.children.push(maybeAttr);
                            reroot(thisNode, maybeAttr.fxn.node);
                            continue loop0;
                        }
                        else {
                            node.children.push(maybeAttr);
                        }
                    }
                }
                ;
            }
            // Rewire nodes to reflect found relationship
            if (relationship !== undefined && relationship.type !== RelationshipTypes.NONE) {
                // For a direct relationship, move the found node to the entity/collection
                if (relationship.type === RelationshipTypes.DIRECT) {
                    if (node.attribute) {
                        var targetNode = void 0;
                        if (node.attribute.collection && node.parent !== node.attribute.collection.node) {
                            targetNode = node.attribute.collection.node;
                        }
                        else if (node.attribute.entity && node.parent !== node.attribute.entity.node) {
                            targetNode = node.attribute.entity.node;
                        }
                        if (targetNode !== undefined) {
                            var rNode = node;
                            node = node.children[0];
                            removeNode(rNode);
                            targetNode.children.push(rNode);
                            continue;
                        }
                    }
                }
                else if (relationship.type === RelationshipTypes.ONEHOP) {
                    log(relationship);
                    if (relationship.nodes[0].collection) {
                        var collection = relationship.nodes[0].collection;
                        var linkID = relationship.links[0];
                        var nCollection = findEveCollection(linkID);
                        if (nCollection !== undefined) {
                            // Create a new link node
                            var token = newToken(nCollection.displayName);
                            var nNode = newNode(token);
                            insertAfterNode(nNode, collection.node);
                            nNode.collection = nCollection;
                            nCollection.node = nNode;
                            context.collections.push(nCollection);
                            // Build a collection attribute to link with parent
                            var collectionAttribute = {
                                id: collection.displayName,
                                displayName: collection.displayName,
                                collection: nCollection,
                                value: "" + collection.displayName,
                                variable: "" + collection.displayName,
                                node: nNode,
                                project: false,
                            };
                            nNode.properties.push(Properties.IMPLICIT);
                            nNode.properties.push(Properties.ATTRIBUTE);
                            nNode.properties.push(Properties.COLLECTION);
                            nNode.attribute = collectionAttribute;
                            context.attributes.push(collectionAttribute);
                            nNode.found = true;
                            nNode.children[0].attribute.collection = nCollection;
                        }
                    }
                    else if (relationship.nodes[0].entity) {
                        var entity = relationship.nodes[0].entity;
                        var linkID = relationship.links[0];
                        var nCollection = findEveCollection(linkID);
                        if (nCollection !== undefined) {
                            // Create a new link node
                            var token = newToken(nCollection.displayName);
                            var nNode = newNode(token);
                            insertAfterNode(nNode, entity.node);
                            nNode.collection = nCollection;
                            nCollection.node = nNode;
                            nNode.properties.push(Properties.IMPLICIT);
                            nNode.properties.push(Properties.ATTRIBUTE);
                            nNode.properties.push(Properties.COLLECTION);
                            nNode.found = true;
                            context.collections.push(nCollection);
                            // Build a collection attribute to link with parent
                            var collectionAttribute = {
                                id: undefined,
                                displayName: nCollection.displayName,
                                collection: nCollection,
                                value: "" + entity.id,
                                variable: "" + entity.displayName,
                                node: nNode,
                                project: false,
                            };
                            nNode.attribute = collectionAttribute;
                            context.attributes.push(collectionAttribute);
                            nNode.children[0].attribute.collection = nCollection;
                        }
                    }
                }
                else if (relationship.type === RelationshipTypes.INTERSECTION) {
                    var _b = relationship.nodes, nodeA = _b[0], nodeB = _b[1];
                    nodeA.collection.variable = nodeB.collection.variable;
                    nodeB.collection.project = false;
                }
            }
            // If no collection or entity has been found, do some work depending on the node
            if (node.found === false) {
                log("Not found");
                log(context);
                context.maybeAttributes.push(node);
            }
            break;
        }
        // Resolve entities for the children
        if (node !== undefined) {
            node.children.map(function (child) { return resolveEntities(child, context); });
        }
        return context;
    }
    log(tree.toString());
    log("Resolving entities...");
    var context = newContext();
    resolveEntities(tree, context);
    log("Entities resolved!");
    // Sort children to preserve argument order in functions
    function sortChildren(node) {
        node.children.sort(function (a, b) { return a.ix - b.ix; });
        node.children.map(sortChildren);
    }
    sortChildren(tree);
    log(tree.toString());
    return { tree: tree, context: context };
}
function cloneEntity(entity) {
    var clone = {
        id: entity.id,
        displayName: entity.displayName,
        content: entity.content,
        node: entity.node,
        entityAttribute: entity.entityAttribute,
        variable: entity.variable,
        project: entity.project,
    };
    return clone;
}
function cloneCollection(collection) {
    var clone = {
        id: collection.id,
        displayName: collection.displayName,
        count: collection.count,
        node: collection.node,
        variable: collection.variable,
        project: collection.project,
    };
    return clone;
}
// Returns the entity with the given display name.
// If the entity is not found, returns undefined
// Two error modes here: 
// 1) the name is not found in "display name"
// 2) the name is found in "display name" but not found in "entity"
// can 2) ever happen?
// Returns the collection with the given display name.
function findEveEntity(search) {
    log("Searching for entity: " + search);
    var foundEntity;
    var name;
    // Try to find by display name first
    var display = app_1.eve.findOne("display name", { name: search });
    if (display !== undefined) {
        foundEntity = app_1.eve.findOne("entity", { entity: display.id });
        name = search;
    }
    else {
        foundEntity = app_1.eve.findOne("entity", { entity: search });
    }
    // Build the entity
    if (foundEntity !== undefined) {
        if (name === undefined) {
            display = app_1.eve.findOne("display name", { id: search });
            name = display.name;
        }
        var entity = {
            id: foundEntity.entity,
            displayName: name,
            content: foundEntity.content,
            variable: foundEntity.entity,
            entityAttribute: false,
            project: true,
        };
        log(" Found: " + name);
        return entity;
    }
    else {
        log(" Not found: " + search);
        return undefined;
    }
}
exports.findEveEntity = findEveEntity;
// Returns the collection with the given display name.
function findEveCollection(search) {
    log("Searching for collection: " + search);
    var foundCollection;
    var name;
    // Try to find by display name first
    var display = app_1.eve.findOne("display name", { name: search });
    if (display !== undefined) {
        foundCollection = app_1.eve.findOne("collection", { collection: display.id });
        name = search;
    }
    else {
        foundCollection = app_1.eve.findOne("collection", { collection: search });
    }
    // Build the collection
    if (foundCollection !== undefined) {
        if (name === undefined) {
            display = app_1.eve.findOne("display name", { id: search });
            name = display.name;
        }
        var collection = {
            id: foundCollection.collection,
            displayName: name,
            count: foundCollection.count,
            variable: name,
            project: true,
        };
        log(" Found: " + name);
        return collection;
    }
    else {
        log(" Not found: " + search);
        return undefined;
    }
}
// Returns the attribute with the given display name attached to the given entity
// If the entity does not have that attribute, or the entity does not exist, returns undefined
function findEveAttribute(name, entity) {
    log("Searching for attribute: " + name);
    log(" Entity: " + entity.displayName);
    var foundAttribute = app_1.eve.findOne("entity eavs", { entity: entity.id, attribute: name });
    if (foundAttribute !== undefined) {
        var attribute = {
            id: foundAttribute.attribute,
            displayName: name,
            entity: entity,
            value: foundAttribute.value,
            variable: (entity.displayName + "|" + name).replace(/ /g, ''),
            project: true,
        };
        log(" Found: " + name + " " + attribute.variable + " => " + attribute.value);
        log(attribute);
        return attribute;
    }
    log(" Not found: " + name);
    return undefined;
}
var RelationshipTypes;
(function (RelationshipTypes) {
    RelationshipTypes[RelationshipTypes["NONE"] = 0] = "NONE";
    RelationshipTypes[RelationshipTypes["DIRECT"] = 1] = "DIRECT";
    RelationshipTypes[RelationshipTypes["ONEHOP"] = 2] = "ONEHOP";
    RelationshipTypes[RelationshipTypes["TWOHOP"] = 3] = "TWOHOP";
    RelationshipTypes[RelationshipTypes["INTERSECTION"] = 4] = "INTERSECTION";
})(RelationshipTypes || (RelationshipTypes = {}));
function findRelationship(nodeA, nodeB, context) {
    log("Finding relationship between \"" + nodeA.name + "\" and \"" + nodeB.name + "\"");
    var relationship;
    // If both nodes are Collections, find their relationship
    if (nodeA.hasProperty(Properties.COLLECTION) && nodeB.hasProperty(Properties.COLLECTION)) {
        relationship = findCollectionToCollectionRelationship(nodeA.collection, nodeB.collection);
        return relationship;
    }
    // If one node is a Collection, and the other node is neither a collection nor an entity
    if (nodeA.hasProperty(Properties.COLLECTION) && !(nodeB.hasProperty(Properties.COLLECTION) || nodeB.hasProperty(Properties.ENTITY))) {
        relationship = findCollectionToAttrRelationship(nodeA.collection, nodeB, context);
        return relationship;
    }
    else if (nodeB.hasProperty(Properties.COLLECTION) && !(nodeA.hasProperty(Properties.COLLECTION) || nodeA.hasProperty(Properties.ENTITY))) {
        relationship = findCollectionToAttrRelationship(nodeB.collection, nodeA, context);
        return relationship;
    }
    // If one node is an entity and the other is a collection 
    if (nodeA.hasProperty(Properties.COLLECTION) && nodeB.hasProperty(Properties.ENTITY)) {
        relationship = findCollectionToEntRelationship(nodeA.collection, nodeB.entity);
    }
    else if (nodeB.hasProperty(Properties.COLLECTION) && nodeA.hasProperty(Properties.ENTITY)) {
        relationship = findCollectionToEntRelationship(nodeB.collection, nodeA.entity);
    }
    // If one node is an Entity, and the other node is neither a collection nor an entity
    if (nodeA.hasProperty(Properties.ENTITY) && !(nodeB.hasProperty(Properties.COLLECTION) || nodeB.hasProperty(Properties.ENTITY))) {
        relationship = findEntToAttrRelationship(nodeA.entity, nodeB, context);
        return relationship;
    }
    else if (nodeB.hasProperty(Properties.ENTITY) && !(nodeA.hasProperty(Properties.COLLECTION) || nodeA.hasProperty(Properties.ENTITY))) {
        relationship = findEntToAttrRelationship(nodeB.entity, nodeA, context);
        return relationship;
    }
    // If one node is an Attribute, and the other node is neither a collection nor an entity
    if (nodeA.hasProperty(Properties.ATTRIBUTE) && !(nodeB.hasProperty(Properties.COLLECTION) || nodeB.hasProperty(Properties.ENTITY))) {
        relationship = findEntToAttrRelationship(nodeA.attribute.entity, nodeB, context);
        return relationship;
    }
    else if (nodeB.hasProperty(Properties.ATTRIBUTE) && !(nodeA.hasProperty(Properties.COLLECTION) || nodeA.hasProperty(Properties.ENTITY))) {
        relationship = findEntToAttrRelationship(nodeB.attribute.entity, nodeA, context);
        return relationship;
    }
    log("No relationship found :(");
    return { type: RelationshipTypes.NONE };
}
// e.g. "meetings john was in"
function findCollectionToEntRelationship(coll, ent) {
    log("Finding Coll -> Ent relationship between \"" + coll.displayName + "\" and \"" + ent.displayName + "\"...");
    /*if (coll === "collections") {
      if (eve.findOne("collection entities", { entity: ent.id })) {
        return { type: RelationshipTypes.DIRECT };
      }
    }*/
    if (app_1.eve.findOne("collection entities", { collection: coll.id, entity: ent.id })) {
        log("Found Direct relationship");
        return { type: RelationshipTypes.DIRECT };
    }
    var relationship = app_1.eve.query("")
        .select("collection entities", { collection: coll.id }, "collection")
        .select("directionless links", { entity: ["collection", "entity"], link: ent.id }, "links")
        .exec();
    if (relationship.unprojected.length) {
        log("Found One-Hop Relationship");
        return { type: RelationshipTypes.ONEHOP };
    } /*
    // e.g. events with chris granger (events -> meetings -> chris granger)
    let relationships2 = eve.query(``)
      .select("collection entities", { collection: coll }, "collection")
      .select("directionless links", { entity: ["collection", "entity"] }, "links")
      .select("directionless links", { entity: ["links", "link"], link: ent }, "links2")
      .exec();
    if (relationships2.unprojected.length) {
      let entities = extractFromUnprojected(relationships2.unprojected, 1, 3);
      return { type: RelationshipTypes.TWOHOP };
    }*/
    log("No relationship found :(");
    return { type: RelationshipTypes.NONE };
}
// e.g. "salaries in engineering"
// e.g. "chris's age"
function findEntToAttrRelationship(entity, attr, context) {
    // Check for a direct relationship
    var found = findEntityAttribute(attr, entity, context);
    if (found === true) {
        return { type: RelationshipTypes.DIRECT };
    }
    // Check for a one-hop relationship
    var relationship = app_1.eve.query("")
        .select("directionless links", { entity: entity.id }, "links")
        .select("entity eavs", { entity: ["links", "link"], attribute: attr.name }, "eav")
        .exec();
    if (relationship.unprojected.length) {
        log("Found One-Hop Relationship");
        log(relationship);
        // Find the one-hop link
        var entities = extractFromUnprojected(relationship.unprojected, 0, 2);
        var collections = findCommonCollections(entities);
        var linkID;
        if (collections.length > 0) {
            // @HACK Choose the correct collection in a smart way. 
            // Largest collection other than entity or testdata?
            linkID = collections[0];
        }
        var entityAttribute = {
            id: attr.name,
            displayName: attr.name,
            value: entity.displayName + "|" + attr.name,
            variable: entity.displayName + "|" + attr.name,
            node: attr,
            project: true,
        };
        attr.attribute = entityAttribute;
        context.attributes.push(entityAttribute);
        attr.properties.push(Properties.ATTRIBUTE);
        attr.found = true;
        return { links: [linkID], type: RelationshipTypes.ONEHOP, nodes: [entity.node, attr] };
    }
    /*
    let relationships2 = eve.query(``)
      .select("directionless links", { entity: entity.id }, "links")
      .select("directionless links", { entity: ["links", "link"] }, "links2")
      .select("entity eavs", { entity: ["links2", "link"], attribute: attr }, "eav")
      .exec();
    if (relationships2.unprojected.length) {
      let entities = extractFromUnprojected(relationships2.unprojected, 0, 3);
      let entities2 = extractFromUnprojected(relationships2.unprojected, 1, 3);
      //return { distance: 2, type: RelationshipTypes.ENTITY_ATTRIBUTE, nodes: [findCommonCollections(entities), findCommonCollections(entities2)] };
    }*/
    log("No relationship found :(");
    return { type: RelationshipTypes.NONE };
}
function findCollectionToCollectionRelationship(collA, collB) {
    log("Finding Coll -> Coll relationship between \"" + collA.displayName + "\" and \"" + collB.displayName + "\"...");
    // are there things in both sets?
    var intersection = app_1.eve.query(collA.displayName + "->" + collB.displayName)
        .select("collection entities", { collection: collA.id }, "collA")
        .select("collection entities", { collection: collB.id, entity: ["collA", "entity"] }, "collB")
        .exec();
    // is there a relationship between things in both sets
    var relationships = app_1.eve.query("relationships between " + collA.displayName + " and " + collB.displayName)
        .select("collection entities", { collection: collA.id }, "collA")
        .select("directionless links", { entity: ["collA", "entity"] }, "links")
        .select("collection entities", { collection: collB.id, entity: ["links", "link"] }, "collB")
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
        // @TODO
        return { type: RelationshipTypes.NONE };
    }
    else if (intersectionSize > maxRel.count) {
        return { type: RelationshipTypes.INTERSECTION, nodes: [collA.node, collB.node] };
    }
    else if (maxRel.count === 0 && intersectionSize === 0) {
        return { type: RelationshipTypes.NONE };
    }
    else {
        // @TODO
        return { type: RelationshipTypes.NONE };
    }
}
exports.findCollectionToCollectionRelationship = findCollectionToCollectionRelationship;
function findCollectionToAttrRelationship(coll, attr, context) {
    // Finds a direct relationship between collection and attribute
    // e.g. "pets' lengths"" => pet -> length
    log("Finding Coll -> Attr relationship between \"" + coll.displayName + "\" and \"" + attr.name + "\"...");
    var relationship = app_1.eve.query("")
        .select("collection entities", { collection: coll.id }, "collection")
        .select("entity eavs", { entity: ["collection", "entity"], attribute: attr.name }, "eav")
        .exec();
    if (relationship.unprojected.length > 0) {
        log("Found Direct Relationship");
        var collectionAttribute = {
            id: attr.name,
            displayName: attr.name,
            collection: coll,
            value: coll.displayName + "|" + attr.name,
            variable: coll.displayName + "|" + attr.name,
            node: attr,
            project: true,
        };
        attr.attribute = collectionAttribute;
        context.attributes.push(collectionAttribute);
        attr.properties.push(Properties.ATTRIBUTE);
        attr.found = true;
        return { type: RelationshipTypes.DIRECT, nodes: [coll.node, attr] };
    }
    // Finds a one hop relationship
    // e.g. "department salaries" => department -> employee -> salary
    relationship = app_1.eve.query("")
        .select("collection entities", { collection: coll.id }, "collection")
        .select("directionless links", { entity: ["collection", "entity"] }, "links")
        .select("entity eavs", { entity: ["links", "link"], attribute: attr.name }, "eav")
        .exec();
    if (relationship.unprojected.length > 0) {
        log("Found One-Hop Relationship");
        log(relationship);
        // Find the one-hop link
        var entities = extractFromUnprojected(relationship.unprojected, 1, 3);
        var collections = findCommonCollections(entities);
        var linkID;
        if (collections.length > 0) {
            // @HACK Choose the correct collection in a smart way. 
            // Largest collection other than entity or testdata?
            linkID = collections[0];
        }
        // Build an attribute for the node
        var attribute = {
            id: attr.name,
            displayName: attr.name,
            collection: coll,
            value: coll.displayName + "|" + attr.name,
            variable: coll.displayName + "|" + attr.name,
            node: attr,
            project: true,
        };
        attr.attribute = attribute;
        context.attributes.push(attribute);
        attr.found = true;
        return { links: [linkID], type: RelationshipTypes.ONEHOP, nodes: [coll.node, attr] };
    }
    // Not sure if this one works... using the entity table, a 2 hop link can
    // be found almost anywhere, yielding results like
    // e.g. "Pets heights" => pets -> snake -> entity -> corey -> height
    /*relationship = eve.query(``)
      .select("collection entities", { collection: coll.id }, "collection")
      .select("directionless links", { entity: ["collection", "entity"] }, "links")
      .select("directionless links", { entity: ["links", "link"] }, "links2")
      .select("entity eavs", { entity: ["links2", "link"], attribute: attr }, "eav")
      .exec();
    if (relationship.unprojected.length > 0) {
      return true;
    }*/
    log("No relationship found :(");
    return { type: RelationshipTypes.NONE };
}
// Extracts entities from unprojected results
function extractFromUnprojected(coll, ix, size) {
    var results = [];
    for (var i = 0, len = coll.length; i < len; i += size) {
        results.push(coll[i + ix]["link"]);
    }
    return results;
}
// Find collections that entities have in common
function findCommonCollections(entities) {
    var intersection = entityTocollectionsArray(entities[0]);
    intersection.sort();
    for (var _i = 0, _a = entities.slice(1); _i < _a.length; _i++) {
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
function entityTocollectionsArray(entity) {
    var entities = app_1.eve.find("collection entities", { entity: entity });
    return entities.map(function (a) { return a["collection"]; });
}
function findCollectionAttribute(node, collection, context, relationship) {
    // The attribute is an attribute of members of the collection
    if (relationship.type === RelationshipTypes.DIRECT) {
        var collectionAttribute = {
            id: node.name,
            displayName: node.name,
            collection: collection,
            value: collection.displayName + "|" + node.name,
            variable: collection.displayName + "|" + node.name,
            node: node,
            project: true,
        };
        node.attribute = collectionAttribute;
        context.attributes.push(collectionAttribute);
        node.found = true;
        return true;
    }
    else if (relationship.type === RelationshipTypes.ONEHOP) {
        var linkID = relationship.links[0];
        var nCollection = findEveCollection(linkID);
        if (nCollection !== undefined) {
            // Create a new link node
            var token = {
                ix: 0,
                originalWord: nCollection.displayName,
                normalizedWord: nCollection.displayName,
                POS: MinorPartsOfSpeech.NN,
                properties: [],
            };
            var nNode = newNode(token);
            insertAfterNode(nNode, collection.node);
            nNode.collection = nCollection;
            nCollection.node = nNode;
            context.collections.push(nCollection);
            // Build a collection attribute to link with parent
            var collectionAttribute = {
                id: collection.displayName,
                displayName: collection.displayName,
                collection: nCollection,
                value: "" + collection.displayName,
                variable: "" + collection.displayName,
                node: nNode,
                project: false,
            };
            nNode.attribute = collectionAttribute;
            context.attributes.push(collectionAttribute);
            nNode.found = true;
            // Build an attribute for the referenced node
            var attribute = {
                id: node.name,
                displayName: node.name,
                collection: nCollection,
                value: nCollection.displayName + "|" + node.name,
                variable: nCollection.displayName + "|" + node.name,
                node: node,
                project: true,
            };
            node.attribute = attribute;
            context.attributes.push(attribute);
            node.found = true;
            return true;
        }
        else {
            var entity = findEveEntity(linkID);
            if (entity !== undefined) {
            }
        }
    }
    return false;
}
function findEntityAttribute(node, entity, context) {
    var attribute = findEveAttribute(node.name, entity);
    if (attribute !== undefined) {
        if (isNumeric(attribute.value)) {
            node.properties.push(Properties.QUANTITY);
        }
        context.attributes.push(attribute);
        node.attribute = attribute;
        node.properties.push(Properties.ATTRIBUTE);
        attribute.node = node;
        // If the node is possessive, check to see if it is an entity
        if (node.hasProperty(Properties.POSSESSIVE) || node.hasProperty(Properties.BACKRELATIONSHIP)) {
            var entity_1 = findEveEntity("" + attribute.value);
            if (entity_1 !== undefined) {
                node.entity = entity_1;
                entity_1.variable = attribute.variable;
                entity_1.entityAttribute = true;
                entity_1.node = node;
                node.parent.entity.project = false;
                attribute.project = false;
                context.entities.push(entity_1);
                node.properties.push(Properties.ENTITY);
            }
        }
        node.found = true;
        var entityNode = entity.node;
        return true;
    }
    return false;
}
// searches for a collection first, then tries to find an entity
function findCollectionOrEntity(node, context) {
    var foundCollection = findCollection(node, context);
    if (foundCollection === true) {
        return true;
    }
    else {
        var foundEntity = findEntity(node, context);
        if (foundEntity === true) {
            return true;
        }
    }
    return false;
}
// searches for a collection first, then tries to find an entity
function findEntityOrCollection(node, context) {
    var foundEntity = findEntity(node, context);
    if (foundEntity === true) {
        return true;
    }
    else {
        var foundCollection = findCollection(node, context);
        if (foundCollection === true) {
            return true;
        }
    }
    return false;
}
function findCollection(node, context) {
    var collection = findEveCollection(node.name);
    if (collection !== undefined) {
        context.collections.push(collection);
        collection.node = node;
        node.collection = collection;
        node.found = true;
        node.properties.push(Properties.COLLECTION);
        if (node.hasProperty(Properties.GROUPING)) {
            context.groupings.push(node);
        }
        return true;
    }
    return false;
}
function findEntity(node, context) {
    var entity = findEveEntity(node.name);
    if (entity !== undefined) {
        context.entities.push(entity);
        entity.node = node;
        node.entity = entity;
        node.found = true;
        node.properties.push(Properties.ENTITY);
        if (node.hasProperty(Properties.GROUPING)) {
            context.groupings.push(node);
        }
        return true;
    }
    return false;
}
function negateTerm(term) {
    var negate = newQuery([term]);
    negate.type = "negate";
    return negate;
}
function newQuery(terms, subqueries, projects) {
    if (terms === undefined) {
        terms = [];
    }
    if (subqueries === undefined) {
        subqueries = [];
    }
    if (projects === undefined) {
        projects = [];
    }
    // Dedupe terms
    var termStrings = terms.map(termToString);
    var uniqueTerms = termStrings.map(function (value, index, self) {
        return self.indexOf(value) === index;
    });
    terms = terms.filter(function (term, index) { return uniqueTerms[index]; });
    var query = {
        type: "query",
        terms: terms,
        subqueries: subqueries,
        projects: projects,
        toString: queryToString,
    };
    function queryToString(depth) {
        if (query.terms.length === 0 && query.projects.length === 0) {
            return "";
        }
        if (depth === undefined) {
            depth = 0;
        }
        var indent = Array(depth + 1).join("\t");
        var queryString = indent + "(";
        // Map each term/subquery/project to a string
        var typeString = query.type;
        var termString = query.terms.map(function (term) { return termToString(term, depth + 1); }).join("\n");
        var subqueriesString = query.subqueries.map(function (query) { return query.toString(depth + 1); }).join("\n");
        var projectsString = query.projects.map(function (term) { return termToString(term, depth + 1); }).join("\n");
        // Now compose the query string
        queryString += typeString;
        queryString += termString === "" ? "" : "\n" + termString;
        queryString += subqueriesString === "" ? "" : "\n" + subqueriesString;
        queryString += projectsString === "" ? "" : "\n" + projectsString;
        // Close out the query
        queryString += "\n" + indent + ")";
        return queryString;
    }
    function termToString(term, depth) {
        if (depth === undefined) {
            depth = 0;
        }
        var indent = Array(depth + 1).join("\t");
        var termString = indent + "(";
        termString += term.type + " ";
        termString += "" + (term.table === undefined ? "" : "\"" + term.table + "\" ");
        termString += term.fields.map(function (field) { return (":" + field.name + " " + (field.variable ? field.value : "\"" + field.value + "\"")); }).join(" ");
        termString += ")";
        return termString;
    }
    return query;
}
exports.newQuery = newQuery;
function formQuery(node) {
    var query = newQuery();
    var projectFields = [];
    // Handle the child nodes
    var childQueries = node.children.map(formQuery);
    // Subsume child queries
    var combinedProjectFields = [];
    for (var _i = 0; _i < childQueries.length; _i++) {
        var cQuery = childQueries[_i];
        query.terms = query.terms.concat(cQuery.terms);
        query.subqueries = query.subqueries.concat(cQuery.subqueries);
        // Combine unnamed projects
        for (var _a = 0, _b = cQuery.projects; _a < _b.length; _a++) {
            var project_1 = _b[_a];
            if (project_1.table === undefined) {
                combinedProjectFields = combinedProjectFields.concat(project_1.fields);
            }
        }
    }
    if (combinedProjectFields.length > 0) {
        var project_2 = {
            type: "project!",
            fields: combinedProjectFields,
        };
        query.projects.push(project_2);
    }
    // If the node is a grouping node, stuff the query into a subquery
    // and take its projects
    if (node.hasProperty(Properties.GROUPING)) {
        var subquery = query;
        query = newQuery();
        query.projects = query.projects.concat(subquery.projects);
        subquery.projects = [];
        query.subqueries.push(subquery);
    }
    // Handle the current node
    // Just return at the root
    if (node.hasProperty(Properties.ROOT)) {
        // Reverse the order of fields in the projects
        for (var _c = 0, _d = query.projects; _c < _d.length; _c++) {
            var project_3 = _d[_c];
            project_3.fields = project_3.fields.reverse();
        }
        return query;
    }
    // Handle functions -------------------------------
    if (node.fxn !== undefined) {
        // Skip functions with no arguments
        if (node.fxn.fields.length === 0) {
            return query;
        }
        var args = findLeafNodes(node).filter(function (node) { return node.found === true; });
        // If we have the right number of arguments, proceed
        // @TODO surface an error if the arguments are wrong
        var output;
        if (args.length === node.fxn.fields.length) {
            var fields = args.map(function (arg, i) {
                return { name: "" + node.fxn.fields[i],
                    value: "" + arg.attribute.variable,
                    variable: true };
            });
            var term = {
                type: "select",
                table: node.fxn.name,
                fields: fields,
            };
            // If an aggregate is grouped, we have to push the aggregate into a subquery
            if (node.fxn.type === FunctionTypes.AGGREGATE && query.subqueries.length > 0) {
                var subquery = query.subqueries[0];
                if (subquery !== undefined) {
                    subquery.terms.push(term);
                }
            }
            else {
                query.terms.push(term);
            }
            // project output if necessary
            if (node.fxn.project === true) {
                var outputFields = args.filter(function (arg) { return arg.hasProperty(Properties.OUTPUT); })
                    .map(function (arg) {
                    return { name: "" + node.fxn.name,
                        value: "" + arg.attribute.variable,
                        variable: true };
                });
                projectFields = projectFields.concat(outputFields);
                query.projects = [];
            }
        }
    }
    // Handle attributes -------------------------------
    if (node.attribute !== undefined) {
        var attr = node.attribute;
        var entity = attr.entity;
        var collection = attr.collection;
        var fields = [];
        var entityField;
        // Entity
        if (entity !== undefined) {
            entityField = { name: "entity",
                value: "" + (attr.entity.entityAttribute ? attr.entity.variable : attr.entity.id),
                variable: attr.entity.entityAttribute };
        }
        else if (collection !== undefined) {
            entityField = { name: "entity",
                value: "" + attr.collection.displayName,
                variable: true };
        }
        else {
            return query;
        }
        fields.push(entityField);
        // Attribute
        if (attr.id !== undefined) {
            var attrField = { name: "attribute",
                value: attr.id,
                variable: false };
            fields.push(attrField);
        }
        // Value
        var valueField = { name: "value",
            value: attr.id === undefined ? attr.value : attr.variable,
            variable: attr.id !== undefined };
        fields.push(valueField);
        var term = {
            type: "select",
            table: "entity eavs",
            fields: fields,
        };
        query.terms.push(term);
        // project if necessary
        if (node.attribute.project === true && !node.hasProperty(Properties.NEGATES)) {
            var attributeField = { name: "" + node.attribute.id,
                value: node.attribute.variable,
                variable: true };
            projectFields.push(attributeField);
        }
    }
    // Handle collections -------------------------------
    if (node.collection !== undefined && !node.hasProperty(Properties.PRONOUN)) {
        var entityField = { name: "entity",
            value: node.collection.variable,
            variable: true };
        var collectionField = { name: "collection",
            value: node.collection.id,
            variable: false };
        var term = {
            type: "select",
            table: "is a attributes",
            fields: [entityField, collectionField],
        };
        query.terms.push(term);
        // project if necessary
        if (node.collection.project === true && !node.hasProperty(Properties.NEGATES)) {
            var collectionField_1 = { name: "" + node.collection.displayName.replace(new RegExp(" ", 'g'), ""),
                value: "" + node.collection.variable,
                variable: true };
            projectFields.push(collectionField_1);
        }
    }
    // Handle entities -------------------------------
    if (node.entity !== undefined && !node.hasProperty(Properties.PRONOUN)) {
        // project if necessary
        if (node.entity.project === true) {
            var entityField = { name: "" + node.entity.displayName.replace(new RegExp(" ", 'g'), ""),
                value: "" + (node.entity.entityAttribute ? node.entity.variable : node.entity.id),
                variable: node.entity.entityAttribute };
            projectFields.push(entityField);
        }
    }
    var project = {
        type: "project!",
        fields: projectFields,
    };
    if (node.hasProperty(Properties.NEGATES)) {
        var negatedTerm = query.terms.pop();
        var negatedQuery = negateTerm(negatedTerm);
        query.subqueries.push(negatedQuery);
    }
    query.projects.push(project);
    return query;
}
// ----------------------------------------------------------------------------
// Debug utility functions
// ---------------------------------------------------------------------------- 
var divider = "----------------------------------------";
exports.debug = false;
function log(x) {
    if (exports.debug) {
        console.log(x);
    }
}
function nodeArrayToString(nodes) {
    var nodeArrayString = nodes.map(function (node) { return node.toString(); }).join("\n" + divider + "\n");
    return divider + "\n" + nodeArrayString + "\n" + divider;
}
exports.nodeArrayToString = nodeArrayToString;
function tokenToString(token) {
    var properties = "(" + token.properties.map(function (property) { return Properties[property]; }).join("|") + ")";
    properties = properties.length === 2 ? "" : properties;
    var tokenSpan = token.start === undefined ? " " : " [" + token.start + "-" + token.end + "] ";
    var tokenString = token.ix + ":" + tokenSpan + " " + token.originalWord + " | " + token.normalizedWord + " | " + MajorPartsOfSpeech[getMajorPOS(token.POS)] + " | " + MinorPartsOfSpeech[token.POS] + " | " + properties;
    return tokenString;
}
exports.tokenToString = tokenToString;
function tokenArrayToString(tokens) {
    var tokenArrayString = tokens.map(function (token) { return tokenToString(token); }).join("\n");
    return divider + "\n" + tokenArrayString + "\n" + divider;
}
exports.tokenArrayToString = tokenArrayToString;
// ----------------------------------------------------------------------------
// Utility functions
// ----------------------------------------------------------------------------
function flattenNestedArray(nestedArray) {
    var flattened = [].concat.apply([], nestedArray);
    return flattened;
}
function onlyUnique(value, index, self) {
    return self.indexOf(value) === index;
}
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
function isNumeric(n) {
    return !isNaN(parseFloat(n)) && isFinite(n);
}
window["NLQP"] = exports;
//# sourceMappingURL=NLQueryParser.js.map