import { createRequire } from "node:module";
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  if (mod && typeof mod === "object" || typeof mod === "function") {
    for (let key of __getOwnPropNames(mod))
      if (!__hasOwnProp.call(to, key))
        __defProp(to, key, {
          get: __accessProp.bind(mod, key),
          enumerable: true
        });
  }
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __require = /* @__PURE__ */ createRequire(import.meta.url);
var __dispose = Symbol.dispose || /* @__PURE__ */ Symbol.for("Symbol.dispose");
var __asyncDispose = Symbol.asyncDispose || /* @__PURE__ */ Symbol.for("Symbol.asyncDispose");
var __using = (stack, value, async) => {
  if (value != null) {
    if (typeof value !== "object" && typeof value !== "function")
      throw TypeError('Object expected to be assigned to "using" declaration');
    var dispose;
    if (async)
      dispose = value[__asyncDispose];
    if (dispose === undefined)
      dispose = value[__dispose];
    if (typeof dispose !== "function")
      throw TypeError("Object not disposable");
    stack.push([async, dispose, value]);
  } else if (async) {
    stack.push([async]);
  }
  return value;
};
var __callDispose = (stack, error, hasError) => {
  var E = typeof SuppressedError === "function" ? SuppressedError : function(e, s, m, _) {
    return _ = Error(m), _.name = "SuppressedError", _.error = e, _.suppressed = s, _;
  }, fail = (e) => error = hasError ? new E(e, error, "An error was suppressed during disposal") : (hasError = true, e), next = (it) => {
    while (it = stack.pop()) {
      try {
        var result = it[1] && it[1].call(it[2]);
        if (it[0])
          return Promise.resolve(result).then(next, (e) => (fail(e), next()));
      } catch (e) {
        fail(e);
      }
    }
    if (hasError)
      throw error;
  };
  return next();
};

// ../../node_modules/.pnpm/emoji-regex@10.6.0/node_modules/emoji-regex/index.js
var require_emoji_regex = __commonJS(function(exports, module) {
  module.exports = () => {
    return /[#*0-9]\uFE0F?\u20E3|[\xA9\xAE\u203C\u2049\u2122\u2139\u2194-\u2199\u21A9\u21AA\u231A\u231B\u2328\u23CF\u23ED-\u23EF\u23F1\u23F2\u23F8-\u23FA\u24C2\u25AA\u25AB\u25B6\u25C0\u25FB\u25FC\u25FE\u2600-\u2604\u260E\u2611\u2614\u2615\u2618\u2620\u2622\u2623\u2626\u262A\u262E\u262F\u2638-\u263A\u2640\u2642\u2648-\u2653\u265F\u2660\u2663\u2665\u2666\u2668\u267B\u267E\u267F\u2692\u2694-\u2697\u2699\u269B\u269C\u26A0\u26A7\u26AA\u26B0\u26B1\u26BD\u26BE\u26C4\u26C8\u26CF\u26D1\u26E9\u26F0-\u26F5\u26F7\u26F8\u26FA\u2702\u2708\u2709\u270F\u2712\u2714\u2716\u271D\u2721\u2733\u2734\u2744\u2747\u2757\u2763\u27A1\u2934\u2935\u2B05-\u2B07\u2B1B\u2B1C\u2B55\u3030\u303D\u3297\u3299]\uFE0F?|[\u261D\u270C\u270D](?:\uD83C[\uDFFB-\uDFFF]|\uFE0F)?|[\u270A\u270B](?:\uD83C[\uDFFB-\uDFFF])?|[\u23E9-\u23EC\u23F0\u23F3\u25FD\u2693\u26A1\u26AB\u26C5\u26CE\u26D4\u26EA\u26FD\u2705\u2728\u274C\u274E\u2753-\u2755\u2795-\u2797\u27B0\u27BF\u2B50]|\u26D3\uFE0F?(?:\u200D\uD83D\uDCA5)?|\u26F9(?:\uD83C[\uDFFB-\uDFFF]|\uFE0F)?(?:\u200D[\u2640\u2642]\uFE0F?)?|\u2764\uFE0F?(?:\u200D(?:\uD83D\uDD25|\uD83E\uDE79))?|\uD83C(?:[\uDC04\uDD70\uDD71\uDD7E\uDD7F\uDE02\uDE37\uDF21\uDF24-\uDF2C\uDF36\uDF7D\uDF96\uDF97\uDF99-\uDF9B\uDF9E\uDF9F\uDFCD\uDFCE\uDFD4-\uDFDF\uDFF5\uDFF7]\uFE0F?|[\uDF85\uDFC2\uDFC7](?:\uD83C[\uDFFB-\uDFFF])?|[\uDFC4\uDFCA](?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDFCB\uDFCC](?:\uD83C[\uDFFB-\uDFFF]|\uFE0F)?(?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDCCF\uDD8E\uDD91-\uDD9A\uDE01\uDE1A\uDE2F\uDE32-\uDE36\uDE38-\uDE3A\uDE50\uDE51\uDF00-\uDF20\uDF2D-\uDF35\uDF37-\uDF43\uDF45-\uDF4A\uDF4C-\uDF7C\uDF7E-\uDF84\uDF86-\uDF93\uDFA0-\uDFC1\uDFC5\uDFC6\uDFC8\uDFC9\uDFCF-\uDFD3\uDFE0-\uDFF0\uDFF8-\uDFFF]|\uDDE6\uD83C[\uDDE8-\uDDEC\uDDEE\uDDF1\uDDF2\uDDF4\uDDF6-\uDDFA\uDDFC\uDDFD\uDDFF]|\uDDE7\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEF\uDDF1-\uDDF4\uDDF6-\uDDF9\uDDFB\uDDFC\uDDFE\uDDFF]|\uDDE8\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDEE\uDDF0-\uDDF7\uDDFA-\uDDFF]|\uDDE9\uD83C[\uDDEA\uDDEC\uDDEF\uDDF0\uDDF2\uDDF4\uDDFF]|\uDDEA\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDED\uDDF7-\uDDFA]|\uDDEB\uD83C[\uDDEE-\uDDF0\uDDF2\uDDF4\uDDF7]|\uDDEC\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEE\uDDF1-\uDDF3\uDDF5-\uDDFA\uDDFC\uDDFE]|\uDDED\uD83C[\uDDF0\uDDF2\uDDF3\uDDF7\uDDF9\uDDFA]|\uDDEE\uD83C[\uDDE8-\uDDEA\uDDF1-\uDDF4\uDDF6-\uDDF9]|\uDDEF\uD83C[\uDDEA\uDDF2\uDDF4\uDDF5]|\uDDF0\uD83C[\uDDEA\uDDEC-\uDDEE\uDDF2\uDDF3\uDDF5\uDDF7\uDDFC\uDDFE\uDDFF]|\uDDF1\uD83C[\uDDE6-\uDDE8\uDDEE\uDDF0\uDDF7-\uDDFB\uDDFE]|\uDDF2\uD83C[\uDDE6\uDDE8-\uDDED\uDDF0-\uDDFF]|\uDDF3\uD83C[\uDDE6\uDDE8\uDDEA-\uDDEC\uDDEE\uDDF1\uDDF4\uDDF5\uDDF7\uDDFA\uDDFF]|\uDDF4\uD83C\uDDF2|\uDDF5\uD83C[\uDDE6\uDDEA-\uDDED\uDDF0-\uDDF3\uDDF7-\uDDF9\uDDFC\uDDFE]|\uDDF6\uD83C\uDDE6|\uDDF7\uD83C[\uDDEA\uDDF4\uDDF8\uDDFA\uDDFC]|\uDDF8\uD83C[\uDDE6-\uDDEA\uDDEC-\uDDF4\uDDF7-\uDDF9\uDDFB\uDDFD-\uDDFF]|\uDDF9\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDED\uDDEF-\uDDF4\uDDF7\uDDF9\uDDFB\uDDFC\uDDFF]|\uDDFA\uD83C[\uDDE6\uDDEC\uDDF2\uDDF3\uDDF8\uDDFE\uDDFF]|\uDDFB\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDEE\uDDF3\uDDFA]|\uDDFC\uD83C[\uDDEB\uDDF8]|\uDDFD\uD83C\uDDF0|\uDDFE\uD83C[\uDDEA\uDDF9]|\uDDFF\uD83C[\uDDE6\uDDF2\uDDFC]|\uDF44(?:\u200D\uD83D\uDFEB)?|\uDF4B(?:\u200D\uD83D\uDFE9)?|\uDFC3(?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D(?:[\u2640\u2642]\uFE0F?(?:\u200D\u27A1\uFE0F?)?|\u27A1\uFE0F?))?|\uDFF3\uFE0F?(?:\u200D(?:\u26A7\uFE0F?|\uD83C\uDF08))?|\uDFF4(?:\u200D\u2620\uFE0F?|\uDB40\uDC67\uDB40\uDC62\uDB40(?:\uDC65\uDB40\uDC6E\uDB40\uDC67|\uDC73\uDB40\uDC63\uDB40\uDC74|\uDC77\uDB40\uDC6C\uDB40\uDC73)\uDB40\uDC7F)?)|\uD83D(?:[\uDC3F\uDCFD\uDD49\uDD4A\uDD6F\uDD70\uDD73\uDD76-\uDD79\uDD87\uDD8A-\uDD8D\uDDA5\uDDA8\uDDB1\uDDB2\uDDBC\uDDC2-\uDDC4\uDDD1-\uDDD3\uDDDC-\uDDDE\uDDE1\uDDE3\uDDE8\uDDEF\uDDF3\uDDFA\uDECB\uDECD-\uDECF\uDEE0-\uDEE5\uDEE9\uDEF0\uDEF3]\uFE0F?|[\uDC42\uDC43\uDC46-\uDC50\uDC66\uDC67\uDC6B-\uDC6D\uDC72\uDC74-\uDC76\uDC78\uDC7C\uDC83\uDC85\uDC8F\uDC91\uDCAA\uDD7A\uDD95\uDD96\uDE4C\uDE4F\uDEC0\uDECC](?:\uD83C[\uDFFB-\uDFFF])?|[\uDC6E-\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4\uDEB5](?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDD74\uDD90](?:\uD83C[\uDFFB-\uDFFF]|\uFE0F)?|[\uDC00-\uDC07\uDC09-\uDC14\uDC16-\uDC25\uDC27-\uDC3A\uDC3C-\uDC3E\uDC40\uDC44\uDC45\uDC51-\uDC65\uDC6A\uDC79-\uDC7B\uDC7D-\uDC80\uDC84\uDC88-\uDC8E\uDC90\uDC92-\uDCA9\uDCAB-\uDCFC\uDCFF-\uDD3D\uDD4B-\uDD4E\uDD50-\uDD67\uDDA4\uDDFB-\uDE2D\uDE2F-\uDE34\uDE37-\uDE41\uDE43\uDE44\uDE48-\uDE4A\uDE80-\uDEA2\uDEA4-\uDEB3\uDEB7-\uDEBF\uDEC1-\uDEC5\uDED0-\uDED2\uDED5-\uDED8\uDEDC-\uDEDF\uDEEB\uDEEC\uDEF4-\uDEFC\uDFE0-\uDFEB\uDFF0]|\uDC08(?:\u200D\u2B1B)?|\uDC15(?:\u200D\uD83E\uDDBA)?|\uDC26(?:\u200D(?:\u2B1B|\uD83D\uDD25))?|\uDC3B(?:\u200D\u2744\uFE0F?)?|\uDC41\uFE0F?(?:\u200D\uD83D\uDDE8\uFE0F?)?|\uDC68(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDC68\uDC69]\u200D\uD83D(?:\uDC66(?:\u200D\uD83D\uDC66)?|\uDC67(?:\u200D\uD83D[\uDC66\uDC67])?)|[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC66(?:\u200D\uD83D\uDC66)?|\uDC67(?:\u200D\uD83D[\uDC66\uDC67])?)|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]))|\uD83C(?:\uDFFB(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC68\uD83C[\uDFFC-\uDFFF])|\uD83E(?:[\uDD1D\uDEEF]\u200D\uD83D\uDC68\uD83C[\uDFFC-\uDFFF]|[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3])))?|\uDFFC(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC68\uD83C[\uDFFB\uDFFD-\uDFFF])|\uD83E(?:[\uDD1D\uDEEF]\u200D\uD83D\uDC68\uD83C[\uDFFB\uDFFD-\uDFFF]|[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3])))?|\uDFFD(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC68\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])|\uD83E(?:[\uDD1D\uDEEF]\u200D\uD83D\uDC68\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF]|[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3])))?|\uDFFE(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC68\uD83C[\uDFFB-\uDFFD\uDFFF])|\uD83E(?:[\uDD1D\uDEEF]\u200D\uD83D\uDC68\uD83C[\uDFFB-\uDFFD\uDFFF]|[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3])))?|\uDFFF(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC68\uD83C[\uDFFB-\uDFFE])|\uD83E(?:[\uDD1D\uDEEF]\u200D\uD83D\uDC68\uD83C[\uDFFB-\uDFFE]|[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3])))?))?|\uDC69(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?[\uDC68\uDC69]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC66(?:\u200D\uD83D\uDC66)?|\uDC67(?:\u200D\uD83D[\uDC66\uDC67])?|\uDC69\u200D\uD83D(?:\uDC66(?:\u200D\uD83D\uDC66)?|\uDC67(?:\u200D\uD83D[\uDC66\uDC67])?))|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]))|\uD83C(?:\uDFFB(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC69\uD83C[\uDFFC-\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFC-\uDFFF]|\uDEEF\u200D\uD83D\uDC69\uD83C[\uDFFC-\uDFFF])))?|\uDFFC(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC69\uD83C[\uDFFB\uDFFD-\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFB\uDFFD-\uDFFF]|\uDEEF\u200D\uD83D\uDC69\uD83C[\uDFFB\uDFFD-\uDFFF])))?|\uDFFD(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC69\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF]|\uDEEF\u200D\uD83D\uDC69\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])))?|\uDFFE(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC69\uD83C[\uDFFB-\uDFFD\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFB-\uDFFD\uDFFF]|\uDEEF\u200D\uD83D\uDC69\uD83C[\uDFFB-\uDFFD\uDFFF])))?|\uDFFF(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC69\uD83C[\uDFFB-\uDFFE])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFB-\uDFFE]|\uDEEF\u200D\uD83D\uDC69\uD83C[\uDFFB-\uDFFE])))?))?|\uDD75(?:\uD83C[\uDFFB-\uDFFF]|\uFE0F)?(?:\u200D[\u2640\u2642]\uFE0F?)?|\uDE2E(?:\u200D\uD83D\uDCA8)?|\uDE35(?:\u200D\uD83D\uDCAB)?|\uDE36(?:\u200D\uD83C\uDF2B\uFE0F?)?|\uDE42(?:\u200D[\u2194\u2195]\uFE0F?)?|\uDEB6(?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D(?:[\u2640\u2642]\uFE0F?(?:\u200D\u27A1\uFE0F?)?|\u27A1\uFE0F?))?)|\uD83E(?:[\uDD0C\uDD0F\uDD18-\uDD1F\uDD30-\uDD34\uDD36\uDD77\uDDB5\uDDB6\uDDBB\uDDD2\uDDD3\uDDD5\uDEC3-\uDEC5\uDEF0\uDEF2-\uDEF8](?:\uD83C[\uDFFB-\uDFFF])?|[\uDD26\uDD35\uDD37-\uDD39\uDD3C-\uDD3E\uDDB8\uDDB9\uDDCD\uDDCF\uDDD4\uDDD6-\uDDDD](?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDDDE\uDDDF](?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDD0D\uDD0E\uDD10-\uDD17\uDD20-\uDD25\uDD27-\uDD2F\uDD3A\uDD3F-\uDD45\uDD47-\uDD76\uDD78-\uDDB4\uDDB7\uDDBA\uDDBC-\uDDCC\uDDD0\uDDE0-\uDDFF\uDE70-\uDE7C\uDE80-\uDE8A\uDE8E-\uDEC2\uDEC6\uDEC8\uDECD-\uDEDC\uDEDF-\uDEEA\uDEEF]|\uDDCE(?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D(?:[\u2640\u2642]\uFE0F?(?:\u200D\u27A1\uFE0F?)?|\u27A1\uFE0F?))?|\uDDD1(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3\uDE70]|\uDD1D\u200D\uD83E\uDDD1|\uDDD1\u200D\uD83E\uDDD2(?:\u200D\uD83E\uDDD2)?|\uDDD2(?:\u200D\uD83E\uDDD2)?))|\uD83C(?:\uDFFB(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFC-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83E\uDDD1\uD83C[\uDFFC-\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3\uDE70]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF]|\uDEEF\u200D\uD83E\uDDD1\uD83C[\uDFFC-\uDFFF])))?|\uDFFC(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFB\uDFFD-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83E\uDDD1\uD83C[\uDFFB\uDFFD-\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3\uDE70]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF]|\uDEEF\u200D\uD83E\uDDD1\uD83C[\uDFFB\uDFFD-\uDFFF])))?|\uDFFD(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83E\uDDD1\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3\uDE70]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF]|\uDEEF\u200D\uD83E\uDDD1\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])))?|\uDFFE(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFB-\uDFFD\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFD\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3\uDE70]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF]|\uDEEF\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFD\uDFFF])))?|\uDFFF(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFB-\uDFFE]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFE])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3\uDE70]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF]|\uDEEF\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFE])))?))?|\uDEF1(?:\uD83C(?:\uDFFB(?:\u200D\uD83E\uDEF2\uD83C[\uDFFC-\uDFFF])?|\uDFFC(?:\u200D\uD83E\uDEF2\uD83C[\uDFFB\uDFFD-\uDFFF])?|\uDFFD(?:\u200D\uD83E\uDEF2\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])?|\uDFFE(?:\u200D\uD83E\uDEF2\uD83C[\uDFFB-\uDFFD\uDFFF])?|\uDFFF(?:\u200D\uD83E\uDEF2\uD83C[\uDFFB-\uDFFE])?))?)/g;
  };
});

// ../../node_modules/.pnpm/fuzzysort@3.1.0/node_modules/fuzzysort/fuzzysort.js
var require_fuzzysort = __commonJS(function(exports, module) {
  ((root, UMD) => {
    if (typeof define === "function" && define.amd)
      define([], UMD);
    else if (typeof module === "object" && module.exports)
      module.exports = UMD();
    else
      root["fuzzysort"] = UMD();
  })(exports, (_) => {
    var single = (search, target) => {
      if (!search || !target)
        return NULL;
      var preparedSearch = getPreparedSearch(search);
      if (!isPrepared(target))
        target = getPrepared(target);
      var searchBitflags = preparedSearch.bitflags;
      if ((searchBitflags & target._bitflags) !== searchBitflags)
        return NULL;
      return algorithm(preparedSearch, target);
    };
    var go = (search, targets, options) => {
      if (!search)
        return options?.all ? all(targets, options) : noResults;
      var preparedSearch = getPreparedSearch(search);
      var searchBitflags = preparedSearch.bitflags;
      var containsSpace = preparedSearch.containsSpace;
      var threshold = denormalizeScore(options?.threshold || 0);
      var limit = options?.limit || INFINITY;
      var resultsLen = 0;
      var limitedCount = 0;
      var targetsLen = targets.length;
      function push_result(result) {
        if (resultsLen < limit) {
          q.add(result);
          ++resultsLen;
        } else {
          ++limitedCount;
          if (result._score > q.peek()._score)
            q.replaceTop(result);
        }
      }
      if (options?.key) {
        var key = options.key;
        for (var i = 0;i < targetsLen; ++i) {
          var obj = targets[i];
          var target = getValue(obj, key);
          if (!target)
            continue;
          if (!isPrepared(target))
            target = getPrepared(target);
          if ((searchBitflags & target._bitflags) !== searchBitflags)
            continue;
          var result = algorithm(preparedSearch, target);
          if (result === NULL)
            continue;
          if (result._score < threshold)
            continue;
          result.obj = obj;
          push_result(result);
        }
      } else if (options?.keys) {
        var keys = options.keys;
        var keysLen = keys.length;
        outer:
          for (var i = 0;i < targetsLen; ++i) {
            var obj = targets[i];
            {
              var keysBitflags = 0;
              for (var keyI = 0;keyI < keysLen; ++keyI) {
                var key = keys[keyI];
                var target = getValue(obj, key);
                if (!target) {
                  tmpTargets[keyI] = noTarget;
                  continue;
                }
                if (!isPrepared(target))
                  target = getPrepared(target);
                tmpTargets[keyI] = target;
                keysBitflags |= target._bitflags;
              }
              if ((searchBitflags & keysBitflags) !== searchBitflags)
                continue;
            }
            if (containsSpace)
              for (let i = 0;i < preparedSearch.spaceSearches.length; i++)
                keysSpacesBestScores[i] = NEGATIVE_INFINITY;
            for (var keyI = 0;keyI < keysLen; ++keyI) {
              target = tmpTargets[keyI];
              if (target === noTarget) {
                tmpResults[keyI] = noTarget;
                continue;
              }
              tmpResults[keyI] = algorithm(preparedSearch, target, false, containsSpace);
              if (tmpResults[keyI] === NULL) {
                tmpResults[keyI] = noTarget;
                continue;
              }
              if (containsSpace)
                for (let i = 0;i < preparedSearch.spaceSearches.length; i++) {
                  if (allowPartialMatchScores[i] > -1000) {
                    if (keysSpacesBestScores[i] > NEGATIVE_INFINITY) {
                      var tmp = (keysSpacesBestScores[i] + allowPartialMatchScores[i]) / 4;
                      if (tmp > keysSpacesBestScores[i])
                        keysSpacesBestScores[i] = tmp;
                    }
                  }
                  if (allowPartialMatchScores[i] > keysSpacesBestScores[i])
                    keysSpacesBestScores[i] = allowPartialMatchScores[i];
                }
            }
            if (containsSpace) {
              for (let i = 0;i < preparedSearch.spaceSearches.length; i++) {
                if (keysSpacesBestScores[i] === NEGATIVE_INFINITY)
                  continue outer;
              }
            } else {
              var hasAtLeast1Match = false;
              for (let i = 0;i < keysLen; i++) {
                if (tmpResults[i]._score !== NEGATIVE_INFINITY) {
                  hasAtLeast1Match = true;
                  break;
                }
              }
              if (!hasAtLeast1Match)
                continue;
            }
            var objResults = new KeysResult(keysLen);
            for (let i = 0;i < keysLen; i++) {
              objResults[i] = tmpResults[i];
            }
            if (containsSpace) {
              var score = 0;
              for (let i = 0;i < preparedSearch.spaceSearches.length; i++)
                score += keysSpacesBestScores[i];
            } else {
              var score = NEGATIVE_INFINITY;
              for (let i = 0;i < keysLen; i++) {
                var result = objResults[i];
                if (result._score > -1000) {
                  if (score > NEGATIVE_INFINITY) {
                    var tmp = (score + result._score) / 4;
                    if (tmp > score)
                      score = tmp;
                  }
                }
                if (result._score > score)
                  score = result._score;
              }
            }
            objResults.obj = obj;
            objResults._score = score;
            if (options?.scoreFn) {
              score = options.scoreFn(objResults);
              if (!score)
                continue;
              score = denormalizeScore(score);
              objResults._score = score;
            }
            if (score < threshold)
              continue;
            push_result(objResults);
          }
      } else {
        for (var i = 0;i < targetsLen; ++i) {
          var target = targets[i];
          if (!target)
            continue;
          if (!isPrepared(target))
            target = getPrepared(target);
          if ((searchBitflags & target._bitflags) !== searchBitflags)
            continue;
          var result = algorithm(preparedSearch, target);
          if (result === NULL)
            continue;
          if (result._score < threshold)
            continue;
          push_result(result);
        }
      }
      if (resultsLen === 0)
        return noResults;
      var results = new Array(resultsLen);
      for (var i = resultsLen - 1;i >= 0; --i)
        results[i] = q.poll();
      results.total = resultsLen + limitedCount;
      return results;
    };
    var highlight = (result, open = "<b>", close = "</b>") => {
      var callback = typeof open === "function" ? open : undefined;
      var target = result.target;
      var targetLen = target.length;
      var indexes = result.indexes;
      var highlighted = "";
      var matchI = 0;
      var indexesI = 0;
      var opened = false;
      var parts = [];
      for (var i = 0;i < targetLen; ++i) {
        var char = target[i];
        if (indexes[indexesI] === i) {
          ++indexesI;
          if (!opened) {
            opened = true;
            if (callback) {
              parts.push(highlighted);
              highlighted = "";
            } else {
              highlighted += open;
            }
          }
          if (indexesI === indexes.length) {
            if (callback) {
              highlighted += char;
              parts.push(callback(highlighted, matchI++));
              highlighted = "";
              parts.push(target.substr(i + 1));
            } else {
              highlighted += char + close + target.substr(i + 1);
            }
            break;
          }
        } else {
          if (opened) {
            opened = false;
            if (callback) {
              parts.push(callback(highlighted, matchI++));
              highlighted = "";
            } else {
              highlighted += close;
            }
          }
        }
        highlighted += char;
      }
      return callback ? parts : highlighted;
    };
    var prepare = (target) => {
      if (typeof target === "number")
        target = "" + target;
      else if (typeof target !== "string")
        target = "";
      var info = prepareLowerInfo(target);
      return new_result(target, { _targetLower: info._lower, _targetLowerCodes: info.lowerCodes, _bitflags: info.bitflags });
    };
    var cleanup = () => {
      preparedCache.clear();
      preparedSearchCache.clear();
    };

    class Result {
      get ["indexes"]() {
        return this._indexes.slice(0, this._indexes.len).sort((a, b) => a - b);
      }
      set ["indexes"](indexes) {
        return this._indexes = indexes;
      }
      ["highlight"](open, close) {
        return highlight(this, open, close);
      }
      get ["score"]() {
        return normalizeScore(this._score);
      }
      set ["score"](score) {
        this._score = denormalizeScore(score);
      }
    }

    class KeysResult extends Array {
      get ["score"]() {
        return normalizeScore(this._score);
      }
      set ["score"](score) {
        this._score = denormalizeScore(score);
      }
    }
    var new_result = (target, options) => {
      const result = new Result;
      result["target"] = target;
      result["obj"] = options.obj ?? NULL;
      result._score = options._score ?? NEGATIVE_INFINITY;
      result._indexes = options._indexes ?? [];
      result._targetLower = options._targetLower ?? "";
      result._targetLowerCodes = options._targetLowerCodes ?? NULL;
      result._nextBeginningIndexes = options._nextBeginningIndexes ?? NULL;
      result._bitflags = options._bitflags ?? 0;
      return result;
    };
    var normalizeScore = (score) => {
      if (score === NEGATIVE_INFINITY)
        return 0;
      if (score > 1)
        return score;
      return Math.E ** (((-score + 1) ** 0.04307 - 1) * -2);
    };
    var denormalizeScore = (normalizedScore) => {
      if (normalizedScore === 0)
        return NEGATIVE_INFINITY;
      if (normalizedScore > 1)
        return normalizedScore;
      return 1 - Math.pow(Math.log(normalizedScore) / -2 + 1, 1 / 0.04307);
    };
    var prepareSearch = (search) => {
      if (typeof search === "number")
        search = "" + search;
      else if (typeof search !== "string")
        search = "";
      search = search.trim();
      var info = prepareLowerInfo(search);
      var spaceSearches = [];
      if (info.containsSpace) {
        var searches = search.split(/\s+/);
        searches = [...new Set(searches)];
        for (var i = 0;i < searches.length; i++) {
          if (searches[i] === "")
            continue;
          var _info = prepareLowerInfo(searches[i]);
          spaceSearches.push({ lowerCodes: _info.lowerCodes, _lower: searches[i].toLowerCase(), containsSpace: false });
        }
      }
      return { lowerCodes: info.lowerCodes, _lower: info._lower, containsSpace: info.containsSpace, bitflags: info.bitflags, spaceSearches };
    };
    var getPrepared = (target) => {
      if (target.length > 999)
        return prepare(target);
      var targetPrepared = preparedCache.get(target);
      if (targetPrepared !== undefined)
        return targetPrepared;
      targetPrepared = prepare(target);
      preparedCache.set(target, targetPrepared);
      return targetPrepared;
    };
    var getPreparedSearch = (search) => {
      if (search.length > 999)
        return prepareSearch(search);
      var searchPrepared = preparedSearchCache.get(search);
      if (searchPrepared !== undefined)
        return searchPrepared;
      searchPrepared = prepareSearch(search);
      preparedSearchCache.set(search, searchPrepared);
      return searchPrepared;
    };
    var all = (targets, options) => {
      var results = [];
      results.total = targets.length;
      var limit = options?.limit || INFINITY;
      if (options?.key) {
        for (var i = 0;i < targets.length; i++) {
          var obj = targets[i];
          var target = getValue(obj, options.key);
          if (target == NULL)
            continue;
          if (!isPrepared(target))
            target = getPrepared(target);
          var result = new_result(target.target, { _score: target._score, obj });
          results.push(result);
          if (results.length >= limit)
            return results;
        }
      } else if (options?.keys) {
        for (var i = 0;i < targets.length; i++) {
          var obj = targets[i];
          var objResults = new KeysResult(options.keys.length);
          for (var keyI = options.keys.length - 1;keyI >= 0; --keyI) {
            var target = getValue(obj, options.keys[keyI]);
            if (!target) {
              objResults[keyI] = noTarget;
              continue;
            }
            if (!isPrepared(target))
              target = getPrepared(target);
            target._score = NEGATIVE_INFINITY;
            target._indexes.len = 0;
            objResults[keyI] = target;
          }
          objResults.obj = obj;
          objResults._score = NEGATIVE_INFINITY;
          results.push(objResults);
          if (results.length >= limit)
            return results;
        }
      } else {
        for (var i = 0;i < targets.length; i++) {
          var target = targets[i];
          if (target == NULL)
            continue;
          if (!isPrepared(target))
            target = getPrepared(target);
          target._score = NEGATIVE_INFINITY;
          target._indexes.len = 0;
          results.push(target);
          if (results.length >= limit)
            return results;
        }
      }
      return results;
    };
    var algorithm = (preparedSearch, prepared, allowSpaces = false, allowPartialMatch = false) => {
      if (allowSpaces === false && preparedSearch.containsSpace)
        return algorithmSpaces(preparedSearch, prepared, allowPartialMatch);
      var searchLower = preparedSearch._lower;
      var searchLowerCodes = preparedSearch.lowerCodes;
      var searchLowerCode = searchLowerCodes[0];
      var targetLowerCodes = prepared._targetLowerCodes;
      var searchLen = searchLowerCodes.length;
      var targetLen = targetLowerCodes.length;
      var searchI = 0;
      var targetI = 0;
      var matchesSimpleLen = 0;
      for (;; ) {
        var isMatch = searchLowerCode === targetLowerCodes[targetI];
        if (isMatch) {
          matchesSimple[matchesSimpleLen++] = targetI;
          ++searchI;
          if (searchI === searchLen)
            break;
          searchLowerCode = searchLowerCodes[searchI];
        }
        ++targetI;
        if (targetI >= targetLen)
          return NULL;
      }
      var searchI = 0;
      var successStrict = false;
      var matchesStrictLen = 0;
      var nextBeginningIndexes = prepared._nextBeginningIndexes;
      if (nextBeginningIndexes === NULL)
        nextBeginningIndexes = prepared._nextBeginningIndexes = prepareNextBeginningIndexes(prepared.target);
      targetI = matchesSimple[0] === 0 ? 0 : nextBeginningIndexes[matchesSimple[0] - 1];
      var backtrackCount = 0;
      if (targetI !== targetLen)
        for (;; ) {
          if (targetI >= targetLen) {
            if (searchI <= 0)
              break;
            ++backtrackCount;
            if (backtrackCount > 200)
              break;
            --searchI;
            var lastMatch = matchesStrict[--matchesStrictLen];
            targetI = nextBeginningIndexes[lastMatch];
          } else {
            var isMatch = searchLowerCodes[searchI] === targetLowerCodes[targetI];
            if (isMatch) {
              matchesStrict[matchesStrictLen++] = targetI;
              ++searchI;
              if (searchI === searchLen) {
                successStrict = true;
                break;
              }
              ++targetI;
            } else {
              targetI = nextBeginningIndexes[targetI];
            }
          }
        }
      var substringIndex = searchLen <= 1 ? -1 : prepared._targetLower.indexOf(searchLower, matchesSimple[0]);
      var isSubstring = !!~substringIndex;
      var isSubstringBeginning = !isSubstring ? false : substringIndex === 0 || prepared._nextBeginningIndexes[substringIndex - 1] === substringIndex;
      if (isSubstring && !isSubstringBeginning) {
        for (var i = 0;i < nextBeginningIndexes.length; i = nextBeginningIndexes[i]) {
          if (i <= substringIndex)
            continue;
          for (var s = 0;s < searchLen; s++)
            if (searchLowerCodes[s] !== prepared._targetLowerCodes[i + s])
              break;
          if (s === searchLen) {
            substringIndex = i;
            isSubstringBeginning = true;
            break;
          }
        }
      }
      var calculateScore = (matches) => {
        var score = 0;
        var extraMatchGroupCount = 0;
        for (var i = 1;i < searchLen; ++i) {
          if (matches[i] - matches[i - 1] !== 1) {
            score -= matches[i];
            ++extraMatchGroupCount;
          }
        }
        var unmatchedDistance = matches[searchLen - 1] - matches[0] - (searchLen - 1);
        score -= (12 + unmatchedDistance) * extraMatchGroupCount;
        if (matches[0] !== 0)
          score -= matches[0] * matches[0] * 0.2;
        if (!successStrict) {
          score *= 1000;
        } else {
          var uniqueBeginningIndexes = 1;
          for (var i = nextBeginningIndexes[0];i < targetLen; i = nextBeginningIndexes[i])
            ++uniqueBeginningIndexes;
          if (uniqueBeginningIndexes > 24)
            score *= (uniqueBeginningIndexes - 24) * 10;
        }
        score -= (targetLen - searchLen) / 2;
        if (isSubstring)
          score /= 1 + searchLen * searchLen * 1;
        if (isSubstringBeginning)
          score /= 1 + searchLen * searchLen * 1;
        score -= (targetLen - searchLen) / 2;
        return score;
      };
      if (!successStrict) {
        if (isSubstring)
          for (var i = 0;i < searchLen; ++i)
            matchesSimple[i] = substringIndex + i;
        var matchesBest = matchesSimple;
        var score = calculateScore(matchesBest);
      } else {
        if (isSubstringBeginning) {
          for (var i = 0;i < searchLen; ++i)
            matchesSimple[i] = substringIndex + i;
          var matchesBest = matchesSimple;
          var score = calculateScore(matchesSimple);
        } else {
          var matchesBest = matchesStrict;
          var score = calculateScore(matchesStrict);
        }
      }
      prepared._score = score;
      for (var i = 0;i < searchLen; ++i)
        prepared._indexes[i] = matchesBest[i];
      prepared._indexes.len = searchLen;
      const result = new Result;
      result.target = prepared.target;
      result._score = prepared._score;
      result._indexes = prepared._indexes;
      return result;
    };
    var algorithmSpaces = (preparedSearch, target, allowPartialMatch) => {
      var seen_indexes = new Set;
      var score = 0;
      var result = NULL;
      var first_seen_index_last_search = 0;
      var searches = preparedSearch.spaceSearches;
      var searchesLen = searches.length;
      var changeslen = 0;
      var resetNextBeginningIndexes = () => {
        for (let i = changeslen - 1;i >= 0; i--)
          target._nextBeginningIndexes[nextBeginningIndexesChanges[i * 2 + 0]] = nextBeginningIndexesChanges[i * 2 + 1];
      };
      var hasAtLeast1Match = false;
      for (var i = 0;i < searchesLen; ++i) {
        allowPartialMatchScores[i] = NEGATIVE_INFINITY;
        var search = searches[i];
        result = algorithm(search, target);
        if (allowPartialMatch) {
          if (result === NULL)
            continue;
          hasAtLeast1Match = true;
        } else {
          if (result === NULL) {
            resetNextBeginningIndexes();
            return NULL;
          }
        }
        var isTheLastSearch = i === searchesLen - 1;
        if (!isTheLastSearch) {
          var indexes = result._indexes;
          var indexesIsConsecutiveSubstring = true;
          for (let i = 0;i < indexes.len - 1; i++) {
            if (indexes[i + 1] - indexes[i] !== 1) {
              indexesIsConsecutiveSubstring = false;
              break;
            }
          }
          if (indexesIsConsecutiveSubstring) {
            var newBeginningIndex = indexes[indexes.len - 1] + 1;
            var toReplace = target._nextBeginningIndexes[newBeginningIndex - 1];
            for (let i = newBeginningIndex - 1;i >= 0; i--) {
              if (toReplace !== target._nextBeginningIndexes[i])
                break;
              target._nextBeginningIndexes[i] = newBeginningIndex;
              nextBeginningIndexesChanges[changeslen * 2 + 0] = i;
              nextBeginningIndexesChanges[changeslen * 2 + 1] = toReplace;
              changeslen++;
            }
          }
        }
        score += result._score / searchesLen;
        allowPartialMatchScores[i] = result._score / searchesLen;
        if (result._indexes[0] < first_seen_index_last_search) {
          score -= (first_seen_index_last_search - result._indexes[0]) * 2;
        }
        first_seen_index_last_search = result._indexes[0];
        for (var j = 0;j < result._indexes.len; ++j)
          seen_indexes.add(result._indexes[j]);
      }
      if (allowPartialMatch && !hasAtLeast1Match)
        return NULL;
      resetNextBeginningIndexes();
      var allowSpacesResult = algorithm(preparedSearch, target, true);
      if (allowSpacesResult !== NULL && allowSpacesResult._score > score) {
        if (allowPartialMatch) {
          for (var i = 0;i < searchesLen; ++i) {
            allowPartialMatchScores[i] = allowSpacesResult._score / searchesLen;
          }
        }
        return allowSpacesResult;
      }
      if (allowPartialMatch)
        result = target;
      result._score = score;
      var i = 0;
      for (let index of seen_indexes)
        result._indexes[i++] = index;
      result._indexes.len = i;
      return result;
    };
    var remove_accents = (str) => str.replace(/\p{Script=Latin}+/gu, (match) => match.normalize("NFD")).replace(/[\u0300-\u036f]/g, "");
    var prepareLowerInfo = (str) => {
      str = remove_accents(str);
      var strLen = str.length;
      var lower = str.toLowerCase();
      var lowerCodes = [];
      var bitflags = 0;
      var containsSpace = false;
      for (var i = 0;i < strLen; ++i) {
        var lowerCode = lowerCodes[i] = lower.charCodeAt(i);
        if (lowerCode === 32) {
          containsSpace = true;
          continue;
        }
        var bit = lowerCode >= 97 && lowerCode <= 122 ? lowerCode - 97 : lowerCode >= 48 && lowerCode <= 57 ? 26 : lowerCode <= 127 ? 30 : 31;
        bitflags |= 1 << bit;
      }
      return { lowerCodes, bitflags, containsSpace, _lower: lower };
    };
    var prepareBeginningIndexes = (target) => {
      var targetLen = target.length;
      var beginningIndexes = [];
      var beginningIndexesLen = 0;
      var wasUpper = false;
      var wasAlphanum = false;
      for (var i = 0;i < targetLen; ++i) {
        var targetCode = target.charCodeAt(i);
        var isUpper = targetCode >= 65 && targetCode <= 90;
        var isAlphanum = isUpper || targetCode >= 97 && targetCode <= 122 || targetCode >= 48 && targetCode <= 57;
        var isBeginning = isUpper && !wasUpper || !wasAlphanum || !isAlphanum;
        wasUpper = isUpper;
        wasAlphanum = isAlphanum;
        if (isBeginning)
          beginningIndexes[beginningIndexesLen++] = i;
      }
      return beginningIndexes;
    };
    var prepareNextBeginningIndexes = (target) => {
      target = remove_accents(target);
      var targetLen = target.length;
      var beginningIndexes = prepareBeginningIndexes(target);
      var nextBeginningIndexes = [];
      var lastIsBeginning = beginningIndexes[0];
      var lastIsBeginningI = 0;
      for (var i = 0;i < targetLen; ++i) {
        if (lastIsBeginning > i) {
          nextBeginningIndexes[i] = lastIsBeginning;
        } else {
          lastIsBeginning = beginningIndexes[++lastIsBeginningI];
          nextBeginningIndexes[i] = lastIsBeginning === undefined ? targetLen : lastIsBeginning;
        }
      }
      return nextBeginningIndexes;
    };
    var preparedCache = new Map;
    var preparedSearchCache = new Map;
    var matchesSimple = [];
    var matchesStrict = [];
    var nextBeginningIndexesChanges = [];
    var keysSpacesBestScores = [];
    var allowPartialMatchScores = [];
    var tmpTargets = [];
    var tmpResults = [];
    var getValue = (obj, prop) => {
      var tmp = obj[prop];
      if (tmp !== undefined)
        return tmp;
      if (typeof prop === "function")
        return prop(obj);
      var segs = prop;
      if (!Array.isArray(prop))
        segs = prop.split(".");
      var len = segs.length;
      var i = -1;
      while (obj && ++i < len)
        obj = obj[segs[i]];
      return obj;
    };
    var isPrepared = (x) => {
      return typeof x === "object" && typeof x._bitflags === "number";
    };
    var INFINITY = Infinity;
    var NEGATIVE_INFINITY = -INFINITY;
    var noResults = [];
    noResults.total = 0;
    var NULL = null;
    var noTarget = prepare("");
    var fastpriorityqueue = (r) => {
      var e = [], o = 0, a = {}, v = (r) => {
        for (var a = 0, v = e[a], c = 1;c < o; ) {
          var s = c + 1;
          a = c, s < o && e[s]._score < e[c]._score && (a = s), e[a - 1 >> 1] = e[a], c = 1 + (a << 1);
        }
        for (var f = a - 1 >> 1;a > 0 && v._score < e[f]._score; f = (a = f) - 1 >> 1)
          e[a] = e[f];
        e[a] = v;
      };
      return a.add = (r) => {
        var a = o;
        e[o++] = r;
        for (var v = a - 1 >> 1;a > 0 && r._score < e[v]._score; v = (a = v) - 1 >> 1)
          e[a] = e[v];
        e[a] = r;
      }, a.poll = (r) => {
        if (o !== 0) {
          var a = e[0];
          return e[0] = e[--o], v(), a;
        }
      }, a.peek = (r) => {
        if (o !== 0)
          return e[0];
      }, a.replaceTop = (r) => {
        e[0] = r, v();
      }, a;
    };
    var q = fastpriorityqueue();
    return { single, go, prepare, cleanup };
  });
});

// src/host-entry-v2.tsx
import { spawn } from "node:child_process";
import { createSignal as createSignal17, onCleanup as onCleanup15, onMount as onMount6, ErrorBoundary } from "solid-js";
import { createComponent as createComponent2, createElement, render, spread } from "@opentui/solid";

// ../runtime/src/engine.ts
import { createCliRenderer } from "@opentui/core";
async function mountEngine(options = {}) {
  const renderer = await createCliRenderer({
    externalOutputMode: "passthrough",
    exitOnCtrlC: false,
    autoFocus: false,
    useMouse: false
  });
  const capture = captureConsoleWhileMounted(options.captureStdout !== false);
  renderer.on("exit", (reason) => {
    capture.restore();
    options.onExit?.(String(reason ?? "exit"));
  });
  options.onReady?.(renderer);
  return { renderer, capture };
}
function captureConsoleWhileMounted(enabled) {
  const captured = [];
  if (!enabled)
    return { restore() {}, lines: () => captured };
  const origConsoleLog = console.log;
  const origConsoleError = console.error;
  const origConsoleWarn = console.warn;
  const origConsoleInfo = console.info;
  const sink = (prefix) => (...args) => {
    captured.push(prefix + args.map(String).join(" "));
  };
  console.log = sink("[log]");
  return {
    restore() {
      console.log = origConsoleLog;
      console.error = origConsoleError;
      console.warn = origConsoleWarn;
      console.info = origConsoleInfo;
    },
    lines: () => [...captured]
  };
}

// ../../../../../../opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cosmokit/lib/index.js
function isNullable(value) {
  return value === null || value === undefined;
}
function isPlainObject(data) {
  return data && typeof data === "object" && !Array.isArray(data);
}
function filterKeys(object, filter) {
  return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
function mapValues(object, transform) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
function pick(source, keys, forced) {
  if (!keys)
    return { ...source };
  const result = {};
  for (const key of keys)
    if (forced || source[key] !== undefined)
      result[key] = source[key];
  return result;
}
var write = Symbol.for("cosmokit.volatile.write");
function snapshot(value, ancestors = /* @__PURE__ */ new Set) {
  if (typeof value === "function")
    throw new TypeError("volatile config cannot contain functions");
  if (value === null || typeof value !== "object")
    return value;
  if (ancestors.has(value))
    throw new TypeError("volatile config cannot contain cycles");
  ancestors.add(value);
  try {
    if (Array.isArray(value))
      return Object.freeze(value.map((item) => snapshot(item, ancestors)));
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
      throw new TypeError("volatile config objects must be plain objects or arrays");
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item, ancestors)])));
  } finally {
    ancestors.delete(value);
  }
}
function createVolatile(value) {
  let current = snapshot(value);
  return Object.freeze({
    get: () => current,
    [write]: (value) => {
      current = value;
    }
  });
}
function isVolatile(value) {
  return typeof value === "object" && value !== null && write in value;
}
function is(type, value) {
  if (arguments.length === 1)
    return (value) => is(type, value);
  return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
  return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
  return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
var Binary;
(function(Binary) {
  Binary.is = isArrayBufferLike;
  Binary.isSource = isArrayBufferSource;
  function fromSource(source) {
    if (ArrayBuffer.isView(source))
      return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    else
      return source;
  }
  Binary.fromSource = fromSource;
  function toBase64(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined")
      return Buffer.from(source).toString("base64");
    let binary = "";
    const bytes = new Uint8Array(source);
    for (let i = 0;i < bytes.byteLength; i++)
      binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  Binary.toBase64 = toBase64;
  function fromBase64(source) {
    if (typeof Buffer !== "undefined")
      return fromSource(Buffer.from(source, "base64"));
    return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
  }
  Binary.fromBase64 = fromBase64;
  function toHex(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined")
      return Buffer.from(source).toString("hex");
    return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  Binary.toHex = toHex;
  function fromHex(source) {
    if (typeof Buffer !== "undefined")
      return fromSource(Buffer.from(source, "hex"));
    const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
    const buffer = [];
    for (let i = 0;i < hex.length; i += 2)
      buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
    return Uint8Array.from(buffer).buffer;
  }
  Binary.fromHex = fromHex;
})(Binary || (Binary = {}));
var base64ToArrayBuffer = Binary.fromBase64;
var arrayBufferToBase64 = Binary.toBase64;
var hexToArrayBuffer = Binary.fromHex;
var arrayBufferToHex = Binary.toHex;
function clone(source, refs = /* @__PURE__ */ new Map) {
  if (!source || typeof source !== "object")
    return source;
  if (is("Date", source))
    return new Date(source.valueOf());
  if (is("RegExp", source))
    return new RegExp(source.source, source.flags);
  if (isArrayBufferLike(source))
    return source.slice(0);
  if (ArrayBuffer.isView(source))
    return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  const cached = refs.get(source);
  if (cached)
    return cached;
  if (Array.isArray(source)) {
    const result = [];
    refs.set(source, result);
    source.forEach((value, index) => {
      result[index] = Reflect.apply(clone, null, [value, refs]);
    });
    return result;
  }
  const result = Object.create(Object.getPrototypeOf(source));
  refs.set(source, result);
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
    if ("value" in descriptor)
      descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
    Reflect.defineProperty(result, key, descriptor);
  }
  return result;
}
function deepEqual(a, b, strict) {
  const ancestors = /* @__PURE__ */ new Set;
  function compare(a, b) {
    if (a === b)
      return true;
    if (isVolatile(a) || isVolatile(b))
      return isVolatile(a) && isVolatile(b);
    if (!strict && isNullable(a) && isNullable(b))
      return true;
    if (typeof a !== typeof b || typeof a !== "object" || !a || !b)
      return false;
    if (ancestors.has(a))
      return false;
    function check(test, then) {
      return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : undefined;
    }
    ancestors.add(a);
    try {
      return check(Array.isArray, (a, b) => {
        if (a.length !== b.length)
          return false;
        for (let index = 0;index < a.length; index++)
          if (!compare(a[index], b[index]))
            return false;
        return true;
      }) ?? check(is("Date"), (a, b) => a.valueOf() === b.valueOf()) ?? check(is("URL"), (a, b) => a.href === b.href) ?? check(is("RegExp"), (a, b) => a.source === b.source && a.flags === b.flags) ?? check(isArrayBufferLike, (a, b) => {
        if (a.byteLength !== b.byteLength)
          return false;
        const viewA = new Uint8Array(a);
        const viewB = new Uint8Array(b);
        for (let i = 0;i < viewA.length; i++)
          if (viewA[i] !== viewB[i])
            return false;
        return true;
      }) ?? ((!strict || [a, b].every((value) => Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) && Object.keys({
        ...a,
        ...b
      }).every((key) => compare(a[key], b[key])));
    } finally {
      ancestors.delete(a);
    }
  }
  return compare(a, b);
}
var Time;
(function(Time) {
  Time.millisecond = 1;
  Time.second = 1000;
  Time.minute = Time.second * 60;
  Time.hour = Time.minute * 60;
  Time.day = Time.hour * 24;
  Time.week = Time.day * 7;
  let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
  function setTimezoneOffset(offset) {
    timezoneOffset = offset;
  }
  Time.setTimezoneOffset = setTimezoneOffset;
  function getTimezoneOffset() {
    return timezoneOffset;
  }
  Time.getTimezoneOffset = getTimezoneOffset;
  function getDateNumber(date = /* @__PURE__ */ new Date, offset) {
    if (typeof date === "number")
      date = new Date(date);
    if (offset === undefined)
      offset = timezoneOffset;
    return Math.floor((date.valueOf() / Time.minute - offset) / 1440);
  }
  Time.getDateNumber = getDateNumber;
  function fromDateNumber(value, offset) {
    const date = new Date(value * Time.day);
    if (offset === undefined)
      offset = timezoneOffset;
    return new Date(+date + offset * Time.minute);
  }
  Time.fromDateNumber = fromDateNumber;
  const numeric = /\d+(?:\.\d+)?/.source;
  const timeRegExp = new RegExp(`^${[
    "w(?:eek(?:s)?)?",
    "d(?:ay(?:s)?)?",
    "h(?:our(?:s)?)?",
    "m(?:in(?:ute)?(?:s)?)?",
    "s(?:ec(?:ond)?(?:s)?)?"
  ].map((unit) => `(${numeric}${unit})?`).join("")}$`);
  function parseTime(source) {
    const capture = timeRegExp.exec(source);
    if (!capture)
      return 0;
    return (parseFloat(capture[1]) * Time.week || 0) + (parseFloat(capture[2]) * Time.day || 0) + (parseFloat(capture[3]) * Time.hour || 0) + (parseFloat(capture[4]) * Time.minute || 0) + (parseFloat(capture[5]) * Time.second || 0);
  }
  Time.parseTime = parseTime;
  function parseDate(date) {
    const parsed = parseTime(date);
    if (parsed)
      date = Date.now() + parsed;
    else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date))
      date = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date}`;
    else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date))
      date = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date}`;
    return date ? new Date(date) : /* @__PURE__ */ new Date;
  }
  Time.parseDate = parseDate;
  function format(ms) {
    const abs = Math.abs(ms);
    if (abs >= Time.day - Time.hour / 2)
      return Math.round(ms / Time.day) + "d";
    else if (abs >= Time.hour - Time.minute / 2)
      return Math.round(ms / Time.hour) + "h";
    else if (abs >= Time.minute - Time.second / 2)
      return Math.round(ms / Time.minute) + "m";
    else if (abs >= Time.second)
      return Math.round(ms / Time.second) + "s";
    return ms + "ms";
  }
  Time.format = format;
  function toDigits(source, length = 2) {
    return source.toString().padStart(length, "0");
  }
  Time.toDigits = toDigits;
  function template(template, time = /* @__PURE__ */ new Date) {
    return template.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
  }
  Time.template = template;
})(Time || (Time = {}));

// ../../../../../../opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/schemastery/lib/index.mjs
var kSchema = Symbol.for("schemastery");
var kValidationError = Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = undefined;
var ValidationError = class extends TypeError {
  options;
  name = "ValidationError";
  constructor(message, options) {
    let prefix = "$";
    for (const segment of options.path || [])
      if (typeof segment === "string")
        prefix += "." + segment;
      else if (typeof segment === "number")
        prefix += "[" + segment + "]";
      else if (typeof segment === "symbol")
        prefix += `[Symbol(${segment.toString()})]`;
    if (prefix.startsWith("."))
      prefix = prefix.slice(1);
    super((prefix === "$" ? "" : `${prefix} `) + message);
    this.options = options;
  }
  static is(error) {
    return !!error?.[kValidationError];
  }
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
var Schema = function(options) {
  const schema = function(data, options = {}) {
    return Schema.resolve(data, schema, options)[0];
  };
  if (options.refs) {
    const refs = mapValues(options.refs, (options) => new Schema(options));
    const getRef = (uid) => refs[uid];
    for (const key in refs) {
      const options = refs[key];
      options.sKey = getRef(options.sKey);
      options.inner = getRef(options.inner);
      options.list = options.list && options.list.map(getRef);
      options.dict = options.dict && mapValues(options.dict, getRef);
    }
    return refs[options.uid];
  }
  Object.assign(schema, options);
  if (typeof schema.callback === "string")
    try {
      schema.callback = new Function("return " + schema.callback)();
    } catch {}
  Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
  Object.setPrototypeOf(schema, Schema.prototype);
  schema.meta ||= {};
  schema.toString = schema.toString.bind(schema);
  return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
  return {
    version: 1,
    vendor: "schemastery",
    validate: (value) => {
      try {
        return { value: Schema.resolve(value, this, {})[0] };
      } catch (error) {
        if (ValidationError.is(error))
          return { issues: [{
            message: error.message,
            path: error.options.path
          }] };
        throw error;
      }
    }
  };
} });
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
  if (globalThis.__schemastery_refs__) {
    globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
    return this.uid;
  }
  globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
  globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
  const result = {
    uid: this.uid,
    refs: globalThis.__schemastery_refs__
  };
  globalThis.__schemastery_refs__ = undefined;
  return result;
};
Schema.prototype.set = function set(key, value) {
  this.dict[key] = value;
  return this;
};
Schema.prototype.push = function push(value) {
  this.list.push(value);
  return this;
};
function mergeDesc(original, messages) {
  const result = typeof original === "string" ? { "": original } : { ...original };
  for (const locale in messages) {
    const value = messages[locale];
    if (value?.$description || value?.$desc)
      result[locale] = value.$description || value.$desc;
    else if (typeof value === "string")
      result[locale] = value;
  }
  return result;
}
function getInner(value) {
  return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
  return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
  const schema = Schema(this);
  const desc = mergeDesc(schema.meta.description, messages);
  if (Object.keys(desc).length)
    schema.meta.description = desc;
  if (schema.dict)
    schema.dict = mapValues(schema.dict, (inner, key) => {
      return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
    });
  if (schema.list)
    schema.list = schema.list.map((inner, index) => {
      return inner.i18n(mapValues(messages, (data = {}) => {
        if (Array.isArray(getInner(data)))
          return getInner(data)[index];
        if (Array.isArray(data))
          return data[index];
        return extractKeys(data);
      }));
    });
  if (schema.inner)
    schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
      if (getInner(data))
        return getInner(data);
      return extractKeys(data);
    }));
  if (schema.sKey)
    schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
  return schema;
};
Schema.prototype.extra = function extra(key, value) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
};
for (const key of [
  "required",
  "disabled",
  "collapse",
  "hidden",
  "loose"
])
  Object.assign(Schema.prototype, { [key](value = true) {
    const schema = Schema(this);
    schema.meta = {
      ...schema.meta,
      [key]: value
    };
    return schema;
  } });
Schema.prototype.deprecated = function deprecated() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({
    text: "deprecated",
    type: "danger"
  });
  return schema;
};
Schema.prototype.experimental = function experimental() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({
    text: "experimental",
    type: "warning"
  });
  return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
  const schema = Schema(this);
  const pattern = pick(regexp, ["source", "flags"]);
  schema.meta = {
    ...schema.meta,
    pattern
  };
  return schema;
};
Schema.prototype.simplify = function simplify(value) {
  if (isVolatile(value))
    value = value.get();
  if (deepEqual(value, this.meta.default, this.type === "dict"))
    return null;
  if (isNullable(value))
    return value;
  if (this.type === "object" || this.type === "dict") {
    const result = {};
    for (const key in value) {
      const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
      if (this.type === "dict" || !isNullable(item))
        result[key] = item;
    }
    if (deepEqual(result, this.meta.default, this.type === "dict"))
      return null;
    return result;
  } else if (this.type === "array" || this.type === "tuple") {
    const result = [];
    value.forEach((value, index) => {
      const schema = this.type === "array" ? this.inner : this.list[index];
      const item = schema ? schema.simplify(value) : value;
      result.push(item);
    });
    return result;
  } else if (this.type === "intersect") {
    const result = {};
    for (const item of this.list)
      Object.assign(result, item.simplify(value));
    return result;
  } else if (this.type === "union")
    for (const schema of this.list)
      try {
        Schema.resolve(value, schema, {});
        return schema.simplify(value);
      } catch {}
  return value;
};
Schema.prototype.toString = function toString(inline) {
  return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    role,
    extra
  };
  return schema;
};
for (const key of [
  "default",
  "link",
  "comment",
  "description",
  "max",
  "min",
  "step"
])
  Object.assign(Schema.prototype, { [key](value) {
    const schema = Schema(this);
    schema.meta = {
      ...schema.meta,
      [key]: value
    };
    return schema;
  } });
Schema.prototype.volatile = function volatile() {
  if (this.meta.volatile)
    throw new TypeError("volatile schema is already wrapped");
  return this.extra("volatile", true);
};
var resolvers = {};
var checkedVolatile = Symbol("checked-volatile-schema");
function validateVolatileSchema(schema, path = [], blocked = false, seen = /* @__PURE__ */ new Map) {
  const states = seen.get(schema) ?? /* @__PURE__ */ new Set;
  if (states.has(blocked))
    return;
  states.add(blocked);
  seen.set(schema, states);
  if (schema.meta?.volatile && blocked)
    throw new ValidationError("volatile fields require a fixed object path without an enclosing volatile field", { path });
  const nested = blocked || !!schema.meta?.volatile;
  if (schema.dict)
    for (const [key, child] of Object.entries(schema.dict))
      validateVolatileSchema(child, [...path, key], nested, seen);
  if (schema.sKey)
    validateVolatileSchema(schema.sKey, [...path, "<key>"], true, seen);
  if (schema.inner && (schema.type !== "lazy" || schema.inner[kSchema]))
    validateVolatileSchema(schema.inner, [...path, "*"], true, seen);
  if (schema.list)
    for (let index = 0;index < schema.list.length; index++)
      validateVolatileSchema(schema.list[index], [...path, String(index)], true, seen);
}
Schema.extend = function extend(type, resolve) {
  resolvers[type] = resolve;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
  if (!schema)
    return [data];
  if (!options[checkedVolatile]) {
    validateVolatileSchema(schema, options.path);
    options = {
      ...options,
      [checkedVolatile]: true
    };
  }
  if (schema.meta?.volatile) {
    const inner = Schema(schema);
    inner.meta = {
      ...schema.meta,
      volatile: false
    };
    const [value, adapted] = Schema.resolve(data, inner, options, strict);
    try {
      return [createVolatile(value), adapted];
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : String(error), options);
    }
  }
  if (options.ignore?.(data, schema))
    return [data];
  if (isNullable(data) && schema.type !== "lazy") {
    if (schema.meta.required)
      throw new ValidationError(`missing required value`, options);
    let current = schema;
    let fallback = schema.meta.default;
    while (current?.type === "intersect" && isNullable(fallback)) {
      current = current.list[0];
      fallback = current?.meta.default;
    }
    if (isNullable(fallback))
      return [data];
    data = clone(fallback);
  }
  const callback = resolvers[schema.type];
  if (!callback)
    throw new ValidationError(`unsupported type "${schema.type}"`, options);
  try {
    return callback(data, schema, options, strict);
  } catch (error) {
    if (!schema.meta.loose)
      throw error;
    return [schema.meta.default];
  }
};
Schema.from = function from(source) {
  if (isNullable(source))
    return Schema.any();
  else if ([
    "string",
    "number",
    "boolean"
  ].includes(typeof source))
    return Schema.const(source).required();
  else if (source[kSchema])
    return source;
  else if (typeof source === "function")
    switch (source) {
      case String:
        return Schema.string().required();
      case Number:
        return Schema.number().required();
      case Boolean:
        return Schema.boolean().required();
      case Function:
        return Schema.function().required();
      default:
        return Schema.is(source).required();
    }
  else
    throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
  const toJSON = () => {
    if (!schema.inner[kSchema]) {
      schema.inner = schema.builder();
      schema.inner.meta = {
        ...schema.meta,
        ...schema.inner.meta
      };
    }
    return schema.inner.toJSON();
  };
  const schema = new Schema({
    type: "lazy",
    builder,
    inner: { toJSON }
  });
  return schema;
};
Schema.natural = function natural() {
  return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
  return Schema.number().step(0.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
  return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
    const date = new Date(value);
    if (isNaN(+date))
      throw new ValidationError(`invalid date "${value}"`, options);
    return date;
  }, true)]);
};
Schema.regExp = function regExp(flag = "") {
  return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
    try {
      return new RegExp(value, flag);
    } catch (e) {
      throw new ValidationError(e.message, options);
    }
  }, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
  return Schema.union([
    Schema.is(ArrayBuffer),
    Schema.is(SharedArrayBuffer),
    Schema.transform(Schema.any(), (value, options) => {
      if (Binary.isSource(value))
        return Binary.fromSource(value);
      throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
    }, true),
    ...encoding ? [Schema.transform(Schema.string(), (value, options) => {
      try {
        return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
      } catch (e) {
        throw new ValidationError(e.message, options);
      }
    }, true)] : []
  ]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
  if (!schema.inner[kSchema]) {
    schema.inner = schema.builder();
    schema.inner.meta = {
      ...schema.meta,
      ...schema.inner.meta
    };
    validateVolatileSchema(schema.inner, options.path, true);
  }
  return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
  return [data];
});
Schema.extend("never", (data, _, options) => {
  throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
  if (deepEqual(data, value))
    return [value];
  throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
  const { max = Infinity, min = -Infinity } = meta;
  if (data > max)
    throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
  if (data < min && !skipMin)
    throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
  if (typeof data !== "string")
    throw new ValidationError(`expected string but got ${data}`, options);
  if (meta.pattern) {
    const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
    if (!regexp.test(data))
      throw new ValidationError(`expect string to match regexp ${regexp}`, options);
  }
  checkWithinRange(data.length, meta, "string length", options);
  return [data];
});
function decimalShift(data, digits) {
  const str = data.toString();
  if (str.includes("e"))
    return data * Math.pow(10, digits);
  const index = str.indexOf(".");
  if (index === -1)
    return data * Math.pow(10, digits);
  const frac = str.slice(index + 1);
  const integer = str.slice(0, index);
  if (frac.length <= digits)
    return +(integer + frac.padEnd(digits, "0"));
  return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
  step = Math.abs(step);
  if (!/^\d+\.\d+$/.test(step.toString()))
    return (data - min) % step === 0;
  const index = step.toString().indexOf(".");
  const digits = step.toString().slice(index + 1).length;
  return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
  if (typeof data !== "number")
    throw new ValidationError(`expected number but got ${data}`, options);
  checkWithinRange(data, meta, "number", options);
  const { step } = meta;
  if (step && !isMultipleOf(data, meta.min ?? 0, step))
    throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
  return [data];
});
Schema.extend("boolean", (data, _, options) => {
  if (typeof data === "boolean")
    return [data];
  throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
  let value = 0, keys = [];
  if (typeof data === "number") {
    value = data;
    for (const key in bits)
      if (data & bits[key])
        keys.push(key);
  } else if (Array.isArray(data)) {
    keys = data;
    for (const key of keys) {
      if (typeof key !== "string")
        throw new ValidationError(`expected string but got ${key}`, options);
      if (key in bits)
        value |= bits[key];
    }
  } else
    throw new ValidationError(`expected number or array but got ${data}`, options);
  if (value === meta.default)
    return [value];
  return [value, keys];
});
Schema.extend("function", (data, _, options) => {
  if (typeof data === "function")
    return [data];
  throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
  if (typeof constructor === "function") {
    if (data instanceof constructor)
      return [data];
    throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
  } else {
    if (isNullable(data))
      throw new ValidationError(`expected ${constructor} but got ${data}`, options);
    let prototype = Object.getPrototypeOf(data);
    while (prototype) {
      if (prototype.constructor?.name === constructor)
        return [data];
      prototype = Object.getPrototypeOf(prototype);
    }
    throw new ValidationError(`expected ${constructor} but got ${data}`, options);
  }
});
function property(data, key, schema, options) {
  try {
    const [value, adapted] = Schema.resolve(data[key], schema, {
      ...options,
      path: [...options.path || [], key]
    });
    if (adapted !== undefined)
      data[key] = adapted;
    return value;
  } catch (e) {
    if (!options?.autofix)
      throw e;
    delete data[key];
    return schema.meta.volatile ? createVolatile(schema.meta.default) : schema.meta.default;
  }
}
Schema.extend("array", (data, { inner, meta }, options) => {
  if (!Array.isArray(data))
    throw new ValidationError(`expected array but got ${data}`, options);
  checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
  return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
  if (!isPlainObject(data))
    throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in data) {
    let rKey;
    try {
      rKey = Schema.resolve(key, sKey, options)[0];
    } catch (error) {
      if (strict)
        continue;
      throw error;
    }
    result[rKey] = property(data, key, inner, options);
    data[rKey] = data[key];
    if (key !== rKey)
      delete data[key];
  }
  return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
  if (!Array.isArray(data))
    throw new ValidationError(`expected array but got ${data}`, options);
  const result = list.map((inner, index) => property(data, index, inner, options));
  if (strict)
    return [result];
  result.push(...data.slice(list.length));
  return [result];
});
function merge(result, data) {
  for (const key in data) {
    if (key in result)
      continue;
    result[key] = data[key];
  }
}
Schema.extend("object", (data, { dict }, options, strict) => {
  if (!isPlainObject(data))
    throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in dict) {
    const value = property(data, key, dict[key], options);
    if (!isNullable(value) || key in data)
      result[key] = value;
  }
  if (!strict)
    merge(result, data);
  return [result];
});
Schema.extend("union", (data, { list, toString }, options, strict) => {
  const messages = [];
  for (const inner of list)
    try {
      return Schema.resolve(data, inner, options, strict);
    } catch (error) {
      messages.push(error);
    }
  throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString }, options, strict) => {
  if (!list.length)
    return [data];
  let result;
  for (const inner of list) {
    const value = Schema.resolve(data, inner, options, true)[0];
    if (isNullable(value))
      continue;
    if (isNullable(result))
      result = value;
    else if (typeof result !== typeof value)
      throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
    else if (typeof value === "object")
      merge(result ??= {}, value);
    else if (result !== value)
      throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
  }
  if (!strict && isPlainObject(data))
    merge(result, data);
  return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
  const [result, adapted = data] = Schema.resolve(data, inner, options, true);
  if (preserve)
    return [callback(result)];
  else
    return [callback(result), callback(adapted)];
});
var formatters = {};
function defineMethod(name, keys, format) {
  formatters[name] = format;
  Object.assign(Schema, { [name](...args) {
    const schema = new Schema({ type: name });
    keys.forEach((key, index) => {
      switch (key) {
        case "sKey":
          schema.sKey = args[index] ?? Schema.string();
          break;
        case "inner":
          schema.inner = Schema.from(args[index]);
          break;
        case "list":
          schema.list = args[index].map(Schema.from);
          break;
        case "dict":
          schema.dict = mapValues(args[index], Schema.from);
          break;
        case "bits":
          schema.bits = {};
          for (const key in args[index]) {
            if (typeof args[index][key] !== "number")
              continue;
            schema.bits[key] = args[index][key];
          }
          break;
        case "callback": {
          const callback = schema.callback = args[index];
          callback["toJSON"] ||= () => callback.toString();
          break;
        }
        case "constructor": {
          const constructor = schema.constructor = args[index];
          if (typeof constructor === "function")
            constructor["toJSON"] ||= () => constructor["name"];
          break;
        }
        default:
          schema[key] = args[index];
      }
    });
    if (name === "object" || name === "dict")
      schema.meta.default = {};
    else if (name === "array" || name === "tuple")
      schema.meta.default = [];
    else if (name === "bitset")
      schema.meta.default = 0;
    return schema;
  } });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
  if (typeof constructor === "function")
    return constructor.name;
  else
    return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
  if (Object.keys(dict).length === 0)
    return "{}";
  return `{ ${Object.entries(dict).map(([key, inner]) => {
    return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
  }).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
  const result = list.map(({ toString: format }) => format()).join(" | ");
  return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
  return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
  "inner",
  "callback",
  "preserve"
], ({ inner }, isInner) => inner.toString(isInner));

// src/plugin-config.ts
var Config = Schema.object({
  maxRounds: Schema.natural().default(0).volatile().description("Global cap on a subagent's LLM round-trips; at the cap a wrap-up is injected. 0 disables the hard-stop policy."),
  maxRoundsGrace: Schema.natural().default(0).volatile().description("Wrap-up grace rounds after the cap; at cap + grace the child is force-stopped. 0 keeps pure-soft mode (wrap-up only).")
});

// src/host-session.ts
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";

// src/agent/loop.ts
var STREAM_TICK_MS = 250;
var CHARS_PER_TOKEN = 4;
function estimateTokens(chars) {
  return Math.max(0, Math.round(chars / CHARS_PER_TOKEN));
}
function tokensPerSecond(tokens, ms) {
  if (ms <= 0 || tokens <= 0)
    return null;
  return tokens * 1000 / ms;
}
function emptyTurnStats() {
  return { startedAt: 0, endedAt: 0, ms: 0, chars: 0, tokens: 0, tps: null, estimated: true };
}
function createStreamTicker(onTick, intervalMs = STREAM_TICK_MS) {
  let chars = 0;
  let lastTickAt = 0;
  return {
    reset() {
      chars = 0;
      lastTickAt = 0;
    },
    add(delta) {
      if (delta <= 0)
        return;
      chars += delta;
      const now = Date.now();
      if (now - lastTickAt >= intervalMs) {
        lastTickAt = now;
        onTick({ chars, at: now });
      }
    },
    finish() {
      if (chars <= 0)
        return;
      const now = Date.now();
      lastTickAt = now;
      onTick({ chars, at: now });
    },
    chars: () => chars
  };
}

// src/subagent-policy.ts
var DEFAULT_SUBAGENT_ROUND_LIMITS = { maxRounds: 0, maxRoundsGrace: 0 };
var SUBAGENT_LIMITS_NS = "dsh-opentui";
function nonNegativeInt(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0)
    return Math.floor(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim()))
    return Number(value.trim());
  return;
}
function parseSubagentRoundLimits(value) {
  if (value === null || typeof value !== "object")
    return { ...DEFAULT_SUBAGENT_ROUND_LIMITS };
  const record = value;
  const maxRounds = nonNegativeInt(record.maxRounds);
  const maxRoundsGrace = nonNegativeInt(record.maxRoundsGrace);
  return {
    maxRounds: maxRounds ?? DEFAULT_SUBAGENT_ROUND_LIMITS.maxRounds,
    maxRoundsGrace: maxRoundsGrace ?? DEFAULT_SUBAGENT_ROUND_LIMITS.maxRoundsGrace
  };
}
function limitsFromSettingsRows(rows) {
  for (const row of rows) {
    if (row?.ns === SUBAGENT_LIMITS_NS)
      return parseSubagentRoundLimits(row.value);
  }
  return { ...DEFAULT_SUBAGENT_ROUND_LIMITS };
}
var FOREGROUND_LABEL_PREFIXES = ["[fg] ", "[use_agent foreground] "];
function bareAgentLabel(label) {
  const trimmed = label.trim();
  for (const prefix of FOREGROUND_LABEL_PREFIXES) {
    if (trimmed.startsWith(prefix))
      return trimmed.slice(prefix.length).trim();
  }
  return trimmed;
}
var SPIN_HIGH_SEGMENT_AT = 0.75;
var SPIN_STRIKE_STALE_MS = 90000;
var EARLY_STOP_SPIN_STREAK = 2;
function earlyFloor(cap) {
  return Math.max(10, Math.floor(cap / 3));
}
function spinDecision(input) {
  if (input.cap <= 0)
    return "none";
  if (input.settled)
    return "none";
  if (input.streak < EARLY_STOP_SPIN_STREAK)
    return "none";
  if (input.now - input.lastStrikeAt >= SPIN_STRIKE_STALE_MS)
    return "none";
  if (!input.wrapupDelivered) {
    return input.count >= earlyFloor(input.cap) && input.count < input.cap ? "wrapup-early" : "none";
  }
  if (input.grace <= 0)
    return "none";
  if (input.wrapupDeliveredAt === undefined)
    return "none";
  if (input.lastStrikeAt <= input.wrapupDeliveredAt)
    return "none";
  if ((input.roundsSinceWrapup ?? 0) < 1)
    return "none";
  return "force-stop-early";
}
function ladderDecision(input) {
  if (input.cap <= 0)
    return "none";
  if (input.settled)
    return "none";
  if (!input.wrapupDelivered) {
    return input.count >= input.cap ? "wrapup" : "none";
  }
  if (input.grace <= 0)
    return "none";
  return input.count >= input.cap + input.grace ? "force-stop" : "none";
}
function wrapupMessage(maxRounds, grace) {
  const base = `Round limit reached (${maxRounds} LLM round-trips, set by the dsh-opentui maxRounds policy). ` + "Do NOT call any more tools. Finish this task NOW: summarize what you have accomplished so far, " + "state clearly what remains undone, and return that summary as your final answer.";
  return grace > 0 ? `${base} You have ${grace} more round${grace === 1 ? "" : "s"} before this run is force-stopped.` : base;
}
function wrapupMessageEarly() {
  return "This run appears to be going in circles — repeating work without forward progress, " + "as judged by the dsh-opentui attention policy. Do NOT call any more tools. Finish NOW with what you have: " + "summarize what was accomplished, state clearly what remains undone, and return that summary as your final answer. " + "If this judgment looks wrong, say so in the summary and stop.";
}

class SubagentRoundPolicy {
  #options;
  #injected = new Set;
  #hardStopped = new Set;
  #resolvedCaps = new Map;
  #injectedLabel = new Map;
  #injectedRound = new Map;
  #injectedAt = new Map;
  #spinState = new Map;
  #disposed = false;
  constructor(options) {
    this.#options = options;
  }
  noteSpinVerdict(childId, score, now = Date.now()) {
    if (this.#disposed || !childId)
      return;
    if (typeof score !== "number" || !Number.isFinite(score))
      return;
    const previous = this.#spinState.get(childId) ?? { streak: 0, lastStrikeAt: 0 };
    if (score >= SPIN_HIGH_SEGMENT_AT) {
      this.#spinState.set(childId, { streak: previous.streak + 1, lastStrikeAt: now });
    } else {
      this.#spinState.set(childId, { streak: 0, lastStrikeAt: 0 });
    }
  }
  getSpinState(childId) {
    return this.#spinState.get(childId) ?? { streak: 0, lastStrikeAt: 0 };
  }
  onRoundCount(childId, count, label) {
    if (this.#disposed || !childId)
      return;
    if (this.#hardStopped.has(childId))
      return;
    const caps = this.#resolveCaps(childId, label ?? this.#injectedLabel.get(childId));
    if (caps === undefined)
      return;
    const settled = this.#options.isSettled?.(childId) ?? false;
    const spin = this.#spinState.get(childId) ?? { streak: 0, lastStrikeAt: 0 };
    const injectedRound = this.#injectedRound.get(childId);
    const spinAction = spinDecision({
      streak: spin.streak,
      lastStrikeAt: spin.lastStrikeAt,
      now: Date.now(),
      count,
      cap: caps.cap,
      grace: caps.grace,
      wrapupDelivered: this.#injected.has(childId),
      wrapupDeliveredAt: this.#injectedAt.get(childId),
      roundsSinceWrapup: injectedRound !== undefined ? count - injectedRound : undefined,
      settled
    });
    if (spinAction === "force-stop-early") {
      this.#hardStopped.add(childId);
      let stoppedEarly = false;
      try {
        stoppedEarly = this.#options.forceStop(childId);
      } catch {
        stoppedEarly = false;
      }
      if (stoppedEarly) {
        try {
          this.#options.onHardStop?.({ childId, round: count, cap: caps.cap, grace: caps.grace, early: true });
        } catch {}
        try {
          this.#options.onSpinStop?.(childId, count);
        } catch {}
      }
      return;
    }
    const action = ladderDecision({
      count,
      cap: caps.cap,
      grace: caps.grace,
      wrapupDelivered: this.#injected.has(childId),
      settled
    });
    if (action === "none" && spinAction !== "wrapup-early")
      return;
    if (action === "wrapup" || spinAction === "wrapup-early") {
      if (this.#injected.has(childId))
        return;
      const rememberedLabel = label ?? this.#injectedLabel.get(childId);
      const early = spinAction === "wrapup-early";
      queueMicrotask(() => {
        if (this.#disposed || this.#injected.has(childId))
          return;
        if (this.#options.isSettled?.(childId) === true)
          return;
        let delivered = false;
        try {
          delivered = this.#options.wrapup(childId, early ? wrapupMessageEarly() : wrapupMessage(caps.cap, caps.grace), rememberedLabel);
        } catch {
          delivered = false;
        }
        const latch = (ok) => {
          if (this.#disposed || this.#injected.has(childId) || this.#hardStopped.has(childId))
            return;
          if (!ok)
            return;
          this.#injected.add(childId);
          if (rememberedLabel !== undefined)
            this.#injectedLabel.set(childId, rememberedLabel);
          this.#injectedRound.set(childId, count);
          this.#injectedAt.set(childId, Date.now());
          try {
            this.#options.onWrapUp?.(childId, count);
          } catch {}
        };
        if (delivered instanceof Promise) {
          delivered.then(latch, () => {});
          return;
        }
        latch(delivered);
      });
      return;
    }
    this.#hardStopped.add(childId);
    let stopped = false;
    try {
      stopped = this.#options.forceStop(childId);
    } catch {
      stopped = false;
    }
    if (stopped) {
      try {
        this.#options.onHardStop?.({ childId, round: count, cap: caps.cap, grace: caps.grace });
      } catch {}
      try {
        this.#options.onForceStop?.(childId, count);
      } catch {}
    }
  }
  #resolveCaps(childId, label) {
    const cached = this.#resolvedCaps.get(childId);
    if (cached !== undefined)
      return cached;
    const limits = this.#options.limits();
    const globalCap = limits.maxRounds;
    if (globalCap <= 0)
      return;
    let cap = globalCap;
    if (label !== undefined && this.#options.resolveAgentCap !== undefined) {
      try {
        const perAgent = this.#options.resolveAgentCap(label);
        if (perAgent !== undefined && perAgent > 0)
          cap = perAgent;
      } catch {}
    }
    const caps = { cap, grace: limits.maxRoundsGrace };
    this.#resolvedCaps.set(childId, caps);
    return caps;
  }
  dispose() {
    this.#disposed = true;
    this.#injected.clear();
    this.#hardStopped.clear();
    this.#resolvedCaps.clear();
    this.#injectedLabel.clear();
    this.#injectedRound.clear();
    this.#injectedAt.clear();
    this.#spinState.clear();
  }
}

// src/spin-attention.ts
var SPIN_JEV_MIN_INTERVAL_MS = 30000;
var SPIN_JEV_TIMEOUT_MS = 8000;
var SPIN_STATE_MAX_CHARS = 1000;
var SPIN_LABEL_MAX_CHARS = 40;
async function loadJevCore() {
  const specifier = "@aiwayds/dsh-jev-core";
  try {
    const mod = await import(specifier);
    if (typeof mod["classify"] !== "function" || typeof mod["isConfigured"] !== "function")
      return null;
    return mod;
  } catch {
    return null;
  }
}
function buildSpinQuestions(id8s) {
  const questions = {};
  for (const id8 of id8s) {
    questions[`spin_${id8}`] = {
      type: "noul",
      criteria: {
        true: "work is UNPRODUCTIVE — repeating the same tools or circling without forward motion",
        false: "work is productive — measurable forward progress"
      }
    };
  }
  return questions;
}
function buildSpinState(views, cap, now) {
  const lines = views.map((view) => {
    const parts = [
      `${view.childId.slice(0, 8)} ${view.label.slice(0, SPIN_LABEL_MAX_CHARS)}`,
      `rounds ${view.rounds}/${cap > 0 ? cap : "∞"}`,
      ...view.startedAt !== undefined ? [`elapsed ${Math.round(Math.max(0, now - view.startedAt) / 1000)}s`] : []
    ];
    return `- ${parts.join(" | ")}`;
  });
  const head = "Subagents under supervision; judge each child on the question keyed by its id.";
  return `${head}
${lines.join(`
`)}`.slice(0, SPIN_STATE_MAX_CHARS);
}
function parseSpinAnswers(answers, id8ToChild) {
  const out = [];
  for (const [id8, childId] of id8ToChild) {
    const answer = answers[`spin_${id8}`];
    if (answer === undefined || typeof answer.value !== "number" || !Number.isFinite(answer.value))
      continue;
    out.push([childId, answer.value]);
  }
  return out;
}
function spinAttentionEnabled(value) {
  if (value === null || typeof value !== "object")
    return true;
  return value.spinAttention !== false;
}
function spinAttentionEnabledFromRows(rows) {
  for (const row of rows) {
    if (row?.ns === "dsh-opentui")
      return spinAttentionEnabled(row.value);
  }
  return true;
}
function createSpinAttentionSource(options) {
  const now = options.now ?? Date.now;
  const minIntervalMs = options.minIntervalMs ?? SPIN_JEV_MIN_INTERVAL_MS;
  const env = options.env ?? process.env;
  let core;
  let loading;
  let lastDispatchAt = -Infinity;
  let inFlight = false;
  let failureCount = 0;
  const ensureLoaded = () => {
    if (options.module !== undefined)
      return Promise.resolve(options.module);
    if (core !== undefined)
      return Promise.resolve(core);
    loading ??= loadJevCore().then((mod) => {
      core = mod;
      return mod;
    });
    return loading;
  };
  return {
    failures: () => failureCount,
    tick(views, cap) {
      if (inFlight)
        return;
      if (!options.enabledReader())
        return;
      const live = views.filter((view) => view.running && view.childId);
      if (live.length === 0)
        return;
      const at = now();
      if (at - lastDispatchAt < minIntervalMs)
        return;
      ensureLoaded().then((mod) => {
        if (mod === null)
          return;
        if (!mod.isConfigured({ env }))
          return;
        const running = views.filter((view) => view.running && view.childId);
        if (running.length === 0)
          return;
        const id8ToChild = new Map(running.map((view) => [view.childId.slice(0, 8), view.childId]));
        const questions = buildSpinQuestions([...id8ToChild.keys()]);
        const state = buildSpinState(running, cap, now());
        if (state.trim() === "")
          return;
        inFlight = true;
        lastDispatchAt = at;
        mod.classify({ questions, state, env, timeoutMs: SPIN_JEV_TIMEOUT_MS }).then((result) => {
          for (const [childId, score] of parseSpinAnswers(result.answers, id8ToChild)) {
            try {
              options.onVerdict(childId, score);
            } catch {}
          }
        }).catch(() => {
          failureCount += 1;
        }).finally(() => {
          inFlight = false;
        });
      });
    }
  };
}

// src/host-session.ts
var DBG = (_m) => {};
function blocksText(content) {
  if (!Array.isArray(content))
    return "";
  let text = "";
  for (const block of content) {
    const typed = block;
    if (typed?.type === "text" && typeof typed.text === "string") {
      text += (text === "" ? "" : `
`) + typed.text;
    }
  }
  return text.trim();
}

class HostSession {
  label = "dsh-host";
  #ctx;
  #handle;
  #sessionId;
  #agentId;
  #cb;
  #resolveTurn;
  #running = false;
  #toolCalls = new Map;
  #override;
  #resumeId;
  #idleTimer;
  #releasedSeq = 0;
  usage = { prompt: 0, completion: 0, cacheRead: 0, cacheWrite: 0 };
  #cachePromptTotal = 0;
  #cacheReadTotal = 0;
  #cacheWriteTotal = 0;
  #lastMessageCacheHitRate = null;
  #journalSink;
  #journalSeq = 0;
  onJournalRecord(listener) {
    this.#journalSink = listener;
    return () => {
      if (this.#journalSink === listener)
        this.#journalSink = undefined;
    };
  }
  #emitJournal(event) {
    if (this.#journalSink === undefined)
      return;
    if (event.type !== "user/message" && event.type !== "assistant/message" && event.type !== "turn/end")
      return;
    this.#journalSink({ seq: ++this.#journalSeq, type: event.type, data: event.data ?? {} });
  }
  cacheHitRate(mode) {
    const total = this.#cacheReadTotal + this.#cacheWriteTotal;
    if (total <= 0)
      return null;
    if (mode === "session") {
      const billed = this.#cachePromptTotal + total;
      return billed > 0 ? this.#cacheReadTotal / billed * 100 : null;
    }
    return this.#lastMessageCacheHitRate;
  }
  #noteDelta() {
    const now = Date.now();
    if (this.#firstDeltaAt === 0)
      this.#firstDeltaAt = now;
    this.#lastDeltaAt = now;
  }
  sessionInfo() {
    return {
      sessionId: this.currentSessionId(),
      model: this.label === "dsh-host" ? undefined : this.label,
      turnCount: this.#turns,
      tokensIn: this.usage.prompt,
      tokensOut: this.usage.completion,
      cacheRead: this.usage.cacheRead,
      cacheWrite: this.usage.cacheWrite,
      lastTurnTps: this.#lastDecode.ms > 0 ? tokensPerSecond(this.#lastDecode.tokens, this.#lastDecode.ms) : this.lastTurnStats.tps,
      sessionAvgTps: tokensPerSecond(this.#decodeTotals.tokens, this.#decodeTotals.ms)
    };
  }
  lastTurnStats = emptyTurnStats();
  #turns = 0;
  #ticker = createStreamTicker((t) => this.#cb?.onStreamTick?.(t));
  #turnStartedAt = 0;
  #turnUsageStart = { prompt: 0, completion: 0 };
  #firstDeltaAt = 0;
  #lastDeltaAt = 0;
  #decodeTotals = { tokens: 0, ms: 0 };
  #lastDecode = { tokens: 0, ms: 0 };
  constructor(ctx) {
    this.#ctx = ctx;
    this.#wire();
    this.#ensureRoundPolicy();
    try {
      const sel = ctx.get?.("agentDefaultModel")?.currentSelection?.();
      if (sel?.provider && sel?.model)
        this.label = `${sel.provider}/${sel.model}${sel.reasoningEffort ? ` (${sel.reasoningEffort})` : ""}`;
    } catch {}
  }
  #providerCache = null;
  async listProviders() {
    if (this.#providerCache)
      return this.#providerCache;
    try {
      const llm = this.#ctx.get?.("llm");
      if (!llm?.listConfigurableProviders)
        return this.#providerCache = [];
      const configurable = await llm.listConfigurableProviders();
      const out = [];
      for (const p of configurable) {
        const provider = String(p?.provider ?? "");
        if (!provider)
          continue;
        let models = [];
        try {
          const list = await llm.listModels(provider);
          models = list.map((m) => String(m?.id ?? m?.model ?? m ?? "")).filter(Boolean);
        } catch {}
        out.push({ provider, models });
      }
      return this.#providerCache = out;
    } catch {
      return this.#providerCache = [];
    }
  }
  switchModel(provider, model, reasoningEffort) {
    this.#override = { provider, model, ...reasoningEffort ? { reasoningEffort } : {} };
    try {
      this.#handle?.dispose?.();
    } catch {}
    this.#handle = undefined;
    this.#sessionId = undefined;
    this.#agentId = undefined;
    this.#disarmIdleRelease();
    this.label = `${provider}/${model}${reasoningEffort ? ` (${reasoningEffort})` : ""}`;
  }
  currentSessionId() {
    return this.#sessionId;
  }
  currentModelSelection() {
    const sel = this.#override ?? this.#ctx.get?.("agentDefaultModel")?.currentSelection?.();
    if (!sel?.provider || !sel?.model)
      return;
    return { provider: sel.provider, model: sel.model, ...sel.reasoningEffort ? { reasoningEffort: sel.reasoningEffort } : {} };
  }
  async currentModelEfforts() {
    try {
      const sel = this.currentModelSelection();
      if (!sel)
        return [];
      const llm = this.#ctx.get?.("llm");
      if (!llm?.resolveModelInfo)
        return [];
      const info = await llm.resolveModelInfo(sel.provider, sel.model);
      const efforts = info?.reasoning?.efforts;
      if (!Array.isArray(efforts) || efforts.length === 0)
        return [];
      return efforts.map((e) => ({
        id: String(e?.id ?? ""),
        name: String(e?.name ?? e?.id ?? ""),
        ...typeof e?.description === "string" && e.description ? { description: e.description } : {}
      })).filter((e) => e.id);
    } catch {
      return [];
    }
  }
  newSession() {
    try {
      this.#handle?.dispose?.();
    } catch {}
    this.#handle = undefined;
    this.#sessionId = undefined;
    this.#agentId = undefined;
    this.#disarmIdleRelease();
    this.#resumeId = undefined;
  }
  resumeSession(id) {
    this.newSession();
    this.#resumeId = id;
    return "ok";
  }
  async storedTranscript(id, skip = 0) {
    if (!id)
      return [];
    const persistence = this.#ctx.get?.("sessionPersistence");
    if (!persistence?.open)
      return [];
    const handle = await persistence.open(id, "read");
    try {
      const events = [];
      let offset = 0;
      for (;; ) {
        const batch = await handle.read(offset);
        if (!batch?.events?.length)
          break;
        events.push(...batch.events);
        offset += batch.events.length;
      }
      const items = [];
      for (const event of skip > 0 ? events.slice(skip) : events) {
        if (event.type === "user/message") {
          const kind = event.data?.source?.kind;
          if (kind !== undefined && kind !== "user")
            continue;
          const text = blocksText(event.data?.content);
          if (text)
            items.push({ kind: "user", text });
        } else if (event.type === "assistant/message") {
          const text = blocksText(event.data?.message?.content);
          if (text)
            items.push({ kind: "assistant", text });
        }
      }
      return items;
    } finally {
      await handle.close?.();
    }
  }
  async listSessions(limit = 12) {
    const persistence = this.#ctx.get?.("sessionPersistence");
    if (!persistence?.list)
      return [];
    try {
      const headers = await persistence.list();
      const cfg = this.configLoad();
      const retentionDays = Number(cfg.retentionDays ?? 0);
      const cutoff = retentionDays > 0 ? Date.now() - retentionDays * 86400000 : 0;
      const out = [];
      for (const entry of headers) {
        const h = entry?.header ?? entry;
        if (h?.origin === "subagent" || (h?.delegationDepth ?? 0) > 0)
          continue;
        const id = String(h?.id ?? "");
        if (!id)
          continue;
        const updatedAt = String(h?.updatedAt ?? h?.lastEventAt ?? h?.mtime ?? "");
        if (cutoff > 0 && updatedAt && new Date(updatedAt).getTime() < cutoff)
          continue;
        out.push({
          id,
          title: String(h?.title ?? h?.firstPrompt ?? h?.name ?? "").slice(0, 40),
          updatedAt
        });
      }
      return out.filter((s) => s.id).sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""))).slice(0, limit);
    } catch {
      return [];
    }
  }
  registerAskProvider(onAsk) {
    this.#ctx.on("user-questions/request", async (request, next) => {
      const asking = request?.agent?.session?.id;
      if (this.#sessionId !== undefined && asking !== undefined && String(asking) !== this.#sessionId)
        return next();
      const questions = request?.questions ?? [];
      if (!questions.length)
        return next();
      const simplified = questions.map((q) => ({
        id: String(q?.id ?? ""),
        prompt: String(q?.prompt ?? q?.question ?? q?.header ?? ""),
        options: (q?.options ?? []).map((o) => String(o?.label ?? o?.value ?? o)),
        ...q?.header !== undefined ? { header: String(q.header) } : {},
        ...q?.detail !== undefined ? { description: String(q.detail) } : {},
        ...q?.multiSelect === true || q?.multi_select === true ? { multiSelect: true } : {}
      }));
      let picks;
      try {
        picks = await onAsk(simplified);
      } catch {
        return { answers: simplified.map((q) => ({ id: q.id, selected: [], custom: "declined" })) };
      }
      return {
        answers: simplified.map((q) => {
          const pick = picks.find((p) => p.questionId === q.id);
          if (!pick)
            return { id: q.id, selected: [], custom: "declined" };
          const selected = pick.selections?.length ? pick.selections : pick.selected ? [pick.selected] : [];
          return selected.length > 0 ? { id: q.id, selected } : { id: q.id, selected: [], custom: "declined" };
        })
      };
    });
  }
  #credentials() {
    try {
      return this.#ctx.get?.("credentials");
    } catch {
      return;
    }
  }
  async credentialStatus(ref) {
    const c = this.#credentials();
    if (c?.describe)
      return c.describe(ref);
    return { configured: false };
  }
  async login(ref, apiKey) {
    const c = this.#credentials();
    if (!c?.set)
      throw new Error("credentials service unavailable in this host");
    await c.set(ref, apiKey);
  }
  async logout(ref) {
    const c = this.#credentials();
    if (!c?.unset)
      throw new Error("credentials service unavailable in this host");
    await c.unset(ref);
  }
  async listHostCommands() {
    try {
      const cmds = this.#ctx.get?.("commands");
      if (!cmds?.list)
        return [];
      const list = this.#handle?.agent ? await cmds.list(this.#handle.agent) : await cmds.list?.();
      return (Array.isArray(list) ? list : []).map((c) => ({ name: String(c?.name ?? ""), description: String(c?.description ?? "") })).filter((c) => c.name);
    } catch {
      return [];
    }
  }
  async executeHostCommand(line) {
    try {
      const cmds = this.#ctx.get?.("commands");
      const agent = this.#handle?.agent;
      if (!cmds?.execute || !agent)
        return { text: "host command service unavailable" };
      const result = await cmds.execute(agent, line, new AbortController().signal);
      const text = result?.message ?? result?.text ?? result?.output;
      return text ? { text: String(text).slice(0, 300) } : {};
    } catch (e) {
      return { text: String(e instanceof Error ? e.message : e).slice(0, 300) };
    }
  }
  #presetId;
  async listPresets() {
    try {
      const registry = this.#ctx.get?.("agentPresets");
      if (!registry?.remoteExportList)
        return [];
      const roster = await registry.remoteExportList();
      const list = Array.isArray(roster) ? roster : roster?.entries ?? roster?.presets ?? [];
      return (Array.isArray(list) ? list : []).map((e) => ({ id: String(e?.id ?? ""), name: String(e?.name ?? e?.id ?? "") })).filter((e) => e.id);
    } catch {
      return [];
    }
  }
  switchPreset(presetId) {
    this.#presetId = presetId;
    this.newSession();
  }
  currentPresetId() {
    return this.#presetId;
  }
  keybindingsLoad() {
    try {
      return JSON.parse(readFileSync(this.configPath("keybindings.json"), "utf8"));
    } catch {
      return {};
    }
  }
  async btwAsk(question, snapshot, onDelta) {
    const sessionId = randomUUID();
    const handle = await this.#ctx.agents.create({
      sessionId,
      meta: { cwd: process.cwd() },
      agentOptions: this.#modelSelection() ?? undefined
    });
    const agentId = handle.agent.id;
    let out = "";
    const ctxAny = this.#ctx;
    return new Promise((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled)
          return;
        settled = true;
        offStream();
        offStatus();
        offTurn();
        try {
          handle.dispose();
        } catch {}
        resolve(out.trim());
      };
      const dbg = (m) => {
        if (process.env.DSH_OPENTUI_DEBUG) {
          try {
            appendFileSync("/tmp/otui-btw.log", `${Date.now()} ${m}
`);
          } catch {}
        }
      };
      dbg(`side agent ${agentId} created`);
      const offStream = ctxAny.on("agent/assistant-stream", ({ agent, frame }) => {
        if (agent.id !== agentId)
          return;
        dbg(`frame ${frame.type} ${frame.chunk?.type ?? ""} ${(frame.chunk?.text ?? "").length}ch`);
        if (frame.type !== "chunk" || !frame.chunk)
          return;
        if (frame.chunk.type === "text-delta" && frame.chunk.text) {
          out += frame.chunk.text;
          onDelta?.(out);
        }
      });
      const offTurn = ctxAny.on("session/event", (session, event) => {
        if (String(session?.id) === sessionId && event.type === "turn/end") {
          dbg(`turn/end reason=${JSON.stringify(event.data?.reason).slice(0, 200)}`);
          if (event.data?.reason?.kind === "error") {
            out = `error: ${String(event.data.reason.error?.message ?? "unknown").slice(0, 200)}`;
          }
          settle();
        }
      });
      const offStatus = ctxAny.on("agent/status", ({ agent, status }) => {
        if (agent.id === agentId)
          dbg(`status ${status}`);
      });
      const snap = snapshot.length > 0 ? `Recent conversation context (for reference only):
${snapshot.join(`
`).slice(-1500)}

` : "";
      const message = createUserMessage({
        content: [{ type: "text", text: `${snap}Side question (answer in one or two sentences, do not use tools): ${question}` }],
        source: { kind: "user" }
      });
      handle.agent.followup(message);
      setTimeout(settle, 120000);
    });
  }
  get settingsSeam() {
    const st = this.#ctx.get?.("settings");
    return st ? { describe: () => st.describe(), mutate: (ns, ops, rev) => st.mutate(ns, ops, rev) } : undefined;
  }
  listAgents() {
    const out = [];
    try {
      const home = process.env.DSH_HOME || join(process.env.HOME || "", ".dsh");
      const dir = join(home, "agents");
      if (!existsSync(dir))
        return [];
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".md"))
          continue;
        const full = join(dir, f);
        try {
          const text = readFileSync(full, "utf8");
          const m = /^---\n([\s\S]*?)\n---/.exec(text);
          const fm = {};
          if (m) {
            for (const line of m[1].split(`
`)) {
              const kv = /^([a-zA-Z_]+):\s*(.*)$/.exec(line.trim());
              if (kv)
                fm[kv[1]] = kv[2].replace(/^"|"$|'"$/g, "").trim();
            }
          }
          out.push({
            name: fm.name ?? f.replace(/\.md$/, ""),
            displayName: fm.display_name,
            description: fm.description,
            model: fm.model,
            thinking: fm.thinking,
            deep: fm.deep,
            maxRounds: fm.maxRounds,
            file: full
          });
        } catch (e) {
          out.push({ name: f, file: full, broken: String(e instanceof Error ? e.message : e).slice(0, 100) });
        }
      }
    } catch {}
    return out;
  }
  agentSet(name, field, value) {
    const home = process.env.DSH_HOME || join(process.env.HOME || "", ".dsh");
    const file = join(home, "agents", `${name}.md`);
    const text = readFileSync(file, "utf8");
    const lineRe = new RegExp(`^(${field}):\\s*.*$`, "m");
    let next;
    if (lineRe.test(text)) {
      next = text.replace(lineRe, `$1: ${value}`);
    } else if (/^---\\n[\\s\\S]*?\\n---/.test(text)) {
      next = text.replace(/^---\n/, `---
${field}: ${value}
`);
    } else {
      next = `---
${field}: ${value}
---

` + text;
    }
    writeFileSync(file, next);
  }
  remoteTailActive = false;
  remoteTailSink = null;
  async startRemoteTail(sessionId) {
    try {
      const home = process.env.DSH_HOME || join(process.env.HOME || "", ".dsh");
      const root = join(home, "sessions");
      let file;
      for (let depth = 0;depth < 4 && !file; depth++) {}
      const walk = (dir, depth) => {
        if (depth > 3)
          return;
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) {
            const found = walk(full, depth + 1);
            if (found)
              return found;
          } else if (name.includes(sessionId) && name.endsWith(".zstd")) {
            return full;
          }
        }
        return;
      };
      file = walk(root, 0);
      if (!file)
        return "log file not found for this session";
      this.remoteTailActive = true;
      const poll = async () => {
        if (!this.remoteTailActive)
          return;
        try {
          const r = await new Promise((res) => {
            const { execFile } = __require("node:child_process");
            execFile("zstd", ["-dc", file], { maxBuffer: 1 << 30 }, (error, stdout) => res({ error, stdout }));
          });
          if (r.error)
            return;
          const rows = [];
          for (const line of r.stdout.split(`
`)) {
            if (!line.trim())
              continue;
            try {
              const ev = JSON.parse(line);
              const type = ev.type ?? "";
              if (!["user/message", "assistant/message", "tool/call", "tool/result"].includes(type))
                continue;
              const text = type === "assistant/message" ? (ev.data?.message?.content ?? []).filter((b) => b?.type === "text").map((b) => b.text).join(`
`) : type === "user/message" ? (ev.data?.content ?? []).filter((b) => b?.type === "text").map((b) => b.text).join(`
`) : `${ev.data?.name ?? "tool"}`;
              if (text.trim())
                rows.push({ kind: type === "user/message" ? "user" : "assistant", text: `${type === "tool/call" || type === "tool/result" ? "⚙ " : ""}${text}` });
            } catch {}
          }
          if (rows.length > 0 && this.remoteTailSink) {
            this.remoteTailSink(rows.map((r2) => ({ kind: r2.kind, text: r2.text, final: true })));
          }
        } catch {}
        if (this.remoteTailActive)
          setTimeout(poll, 2000);
      };
      poll();
      return;
    } catch (e) {
      return String(e instanceof Error ? e.message : e).slice(0, 150);
    }
  }
  stopRemoteTail() {
    this.remoteTailActive = false;
  }
  async searchSessions(query) {
    try {
      const q = this.#ctx.get?.("sessionQuery");
      if (!q?.searchSessions)
        return [];
      const res = await q.searchSessions({ query, limit: 10 });
      return (res?.items ?? []).map((it) => ({
        id: String(it?.header?.id ?? ""),
        snippet: String(it?.bestMatch?.snippet ?? "").replace(/\s+/g, " ").slice(0, 80)
      })).filter((it) => it.id);
    } catch {
      return [];
    }
  }
  async settingsDescribe() {
    try {
      const st = this.#ctx.get?.("settings");
      if (!st?.describe)
        return [];
      const out = await st.describe();
      return (Array.isArray(out) ? out : []).map((e) => ({ ns: String(e?.ns ?? ""), revision: e?.revision, value: e?.value }));
    } catch {
      return [];
    }
  }
  async settingsMutate(ns, ops, revision) {
    const st = this.#ctx.get?.("settings");
    if (!st?.mutate)
      throw new Error("settings service unavailable");
    await st.mutate(ns, ops, revision);
  }
  configPath(name = "config.json") {
    let dir = new URL(".", import.meta.url).pathname;
    for (let i = 0;i < 8; i++) {
      if (existsSync(join(dir, "cordis.patch.yml")))
        return join(dir, name);
      const parent = join(dir, "..");
      if (parent === dir)
        break;
      dir = parent;
    }
    const home = process.env.DSH_HOME || join(process.env.HOME || "", ".dsh");
    return join(home, "profiles", "dsh-opentui", name);
  }
  configLoad() {
    try {
      return JSON.parse(readFileSync(this.configPath(), "utf8"));
    } catch {
      return {};
    }
  }
  configSave(patch) {
    const merged = { ...this.configLoad(), ...patch };
    writeFileSync(this.configPath(), JSON.stringify(merged, null, 2) + `
`);
    return merged;
  }
  repairScan() {
    const out = [];
    try {
      const home = process.env.DSH_HOME || join(process.env.HOME || "", ".dsh");
      const root = join(home, "sessions");
      if (!existsSync(root))
        return ["no sessions directory"];
      let total = 0;
      let ok = 0;
      const broken = [];
      const visit = (dir, depth) => {
        if (depth > 4)
          return;
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) {
            visit(full, depth + 1);
            continue;
          }
          if (!(name.startsWith("session.") && (name.endsWith(".zstd") || name.endsWith(".jsonl"))))
            continue;
          total += 1;
          const size = statSync(full).size;
          if (size === 0) {
            broken.push(`${name} (0 bytes)`);
            continue;
          }
          if (name.endsWith(".zstd")) {
            const buf = readFileSync(full);
            const magicOk = buf[0] === 40 && buf[1] === 181 && buf[2] === 47 && buf[3] === 253;
            if (!magicOk) {
              broken.push(`${name} (not a zstd frame)`);
              continue;
            }
            ok += 1;
            continue;
          }
          try {
            const text = readFileSync(full, "utf8").trim();
            const last = text.split(`
`).filter((l) => l.trim()).pop() ?? "{}";
            JSON.parse(last);
            ok += 1;
          } catch {
            broken.push(`${name} (invalid jsonl tail)`);
          }
        }
      };
      visit(root, 0);
      out.push(`sessions: ${total} logs scanned, ${ok} healthy`);
      if (broken.length === 0)
        out.push("no broken logs found");
      else {
        out.push(`broken: ${broken.length}`);
        for (const b of broken.slice(0, 8))
          out.push(`  ✗ ${b}`);
        if (broken.length > 8)
          out.push(`  … +${broken.length - 8} more`);
      }
    } catch (e) {
      out.push(`scan failed: ${String(e instanceof Error ? e.message : e).slice(0, 150)}`);
    }
    return out;
  }
  listSkills() {
    try {
      const reg = this.#ctx.get?.("skills");
      if (!reg?.list)
        return [];
      const list = reg.list() ?? [];
      return list.map((x) => ({
        name: String(x?.name ?? ""),
        description: String(x?.description ?? "").slice(0, 90),
        invocation: String(x?.invocation ?? "")
      })).filter((x) => x.name);
    } catch {
      return [];
    }
  }
  async reloadPlugins() {
    try {
      const loader = this.#ctx.get?.("loader");
      if (!loader)
        return "loader service unavailable";
      await loader.reload?.(new URL("../dist-host/index.js", import.meta.url).href);
      return;
    } catch (e) {
      return String(e instanceof Error ? e.message : e).slice(0, 200);
    }
  }
  listPlugins() {
    try {
      const root = new URL("../../../../package.json", import.meta.url).pathname;
      const pkg = JSON.parse(readFileSync(root, "utf8"));
      const out = [];
      for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
        if (name.startsWith("@deepseek-ai/"))
          continue;
        let version = range;
        try {
          version = JSON.parse(readFileSync(new URL(`../../../../node_modules/${name}/package.json`, import.meta.url).pathname, "utf8")).version;
        } catch {}
        out.push({ name, version });
      }
      return out;
    } catch {
      return [];
    }
  }
  executionMode() {
    try {
      const tools = this.#ctx.get?.("tools");
      if (typeof tools?.schemas !== "function")
        return "native";
      const schemas = tools.schemas(this.#handle?.agent) ?? [];
      return schemas.some((schema) => schema?.name === "run_code") ? "ptc" : "native";
    } catch {
      return "native";
    }
  }
  usageSummary() {
    const fmt = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
    const lines = [
      `turns ${this.#turns}`,
      `prompt ${fmt(this.usage.prompt)} tok`,
      `completion ${fmt(this.usage.completion)} tok`
    ];
    const s = this.lastTurnStats;
    if (s.ms > 0) {
      const rate = s.tps === null ? "" : ` · ${Math.round(s.tps)} tok/s${s.estimated ? " (estimated)" : ""}`;
      lines.push(`last turn ${(s.ms / 1000).toFixed(1)}s${rate}`);
    }
    return lines;
  }
  async turn(userText, cb, _signal) {
    this.#cb = cb;
    this.#disarmIdleRelease();
    this.#turns++;
    this.#ticker.reset();
    this.#turnStartedAt = Date.now();
    this.#turnUsageStart = { prompt: this.usage.prompt, completion: this.usage.completion };
    if (!this.#handle) {
      const reattach = this.#isReleasedForReattach();
      this.#sessionId = this.#resumeId ?? this.#sessionId ?? randomUUID();
      this.#resumeId = undefined;
      if (reattach)
        this.#presetId = undefined;
      const agentOptions = this.#modelSelection() ?? {};
      try {
        this.#handle = await this.#ctx.agents.create({
          sessionId: this.#sessionId,
          meta: { cwd: process.cwd(), ...this.#presetId ? { agentPreset: this.#presetId } : {} },
          agentOptions
        });
      } catch (error) {
        if (reattach && error?.name === "SessionAlreadyOwnedError") {
          throw new Error("session is being driven by another process (phone/web) — send again later to re-take it, or /new for a fresh session");
        }
        throw error;
      }
      this.#agentId = this.#handle.agent.id;
      DBG(`session created ${this.#sessionId} agent=${this.#agentId}`);
      if (reattach) {
        const missed = await this.storedTranscript(this.#sessionId, this.#releasedSeq);
        this.#releasedSeq = 0;
        if (missed.length > 0)
          cb.onReattachedMissed?.(missed);
      }
    }
    const message = createUserMessage({
      content: [
        { type: "text", text: userText },
        ...this.#pendingImages.map((ref) => ({ type: "image", attachment: ref }))
      ],
      source: { kind: "user" }
    });
    this.#pendingImages = [];
    this.#handle.agent.followup(message);
    await new Promise((resolve) => {
      this.#resolveTurn = resolve;
    });
  }
  #pendingImages = [];
  #idleReleaseMs() {
    const cfg = this.configLoad();
    const sec = Number(cfg.idleReleaseSec ?? 600);
    if (!Number.isFinite(sec) || sec <= 0)
      return 0;
    return sec * 1000;
  }
  #armIdleRelease() {
    this.#disarmIdleRelease();
    const ms = this.#idleReleaseMs();
    if (ms <= 0 || this.#sessionId === undefined)
      return;
    const timer = setTimeout(() => this.#releaseIdle(), ms);
    timer.unref?.();
    this.#idleTimer = timer;
  }
  #disarmIdleRelease() {
    if (this.#idleTimer === undefined)
      return;
    clearTimeout(this.#idleTimer);
    this.#idleTimer = undefined;
  }
  #releaseIdle() {
    this.#idleTimer = undefined;
    if (this.#handle === undefined || this.#running)
      return;
    this.#releasedSeq = this.#snapshot().length;
    this.#toolCalls.clear();
    try {
      this.#handle?.dispose?.();
    } catch {}
    this.#handle = undefined;
    this.#agentId = undefined;
  }
  #isReleasedForReattach() {
    return this.#handle === undefined && this.#sessionId !== undefined && this.#resumeId === undefined;
  }
  #children = new Map;
  #runSeqToChild = new Map;
  #childLogs = new Map;
  #childAgents = new Map;
  #roundPolicy;
  #roundLimits = { ...DEFAULT_SUBAGENT_ROUND_LIMITS };
  #roundLimitsRefreshing = false;
  #spinAttention;
  #spinAttentionOn = true;
  #ensureRoundPolicy() {
    if (this.#roundPolicy === undefined) {
      this.#roundPolicy = new SubagentRoundPolicy({
        limits: () => this.#roundLimits,
        resolveAgentCap: (label) => {
          const stripped = bareAgentLabel(label);
          const row = this.listAgents().find((a) => a.name === label || a.name === stripped || a.displayName !== undefined && (a.displayName === label || a.displayName === stripped) || label.endsWith(` ${a.name}`));
          const raw = row?.maxRounds;
          if (raw === undefined)
            return;
          const n = Number(String(raw).trim());
          return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
        },
        isSettled: (childId) => this.#children.get(childId)?.status !== "running",
        wrapup: (childId, message) => this.steerChildDetailed(childId, message).then((r) => r.ok),
        forceStop: (childId) => this.cancelChild(childId),
        onHardStop: (record) => this.#onHardStop(record),
        onWrapUp: (childId, round) => {
          const existing = this.#children.get(childId);
          if (!existing)
            return;
          this.#children.set(childId, { ...existing, injectedRound: round });
          this.#emitChildren();
        },
        onForceStop: (childId, round) => {
          const existing = this.#children.get(childId);
          if (!existing)
            return;
          this.#children.set(childId, { ...existing, hardStopRound: round });
          this.#emitChildren();
        },
        onSpinStop: (childId, round) => {
          const existing = this.#children.get(childId);
          if (!existing)
            return;
          this.#children.set(childId, { ...existing, spinStopRound: round });
          this.#emitChildren();
        }
      });
      this.#refreshRoundLimits();
    }
    return this.#roundPolicy;
  }
  #refreshRoundLimits() {
    if (this.#roundLimitsRefreshing)
      return;
    this.#roundLimitsRefreshing = true;
    this.settingsDescribe().then((rows) => {
      this.#roundLimits = limitsFromSettingsRows(rows);
      this.#spinAttentionOn = spinAttentionEnabledFromRows(rows);
    }).catch(() => {}).finally(() => {
      this.#roundLimitsRefreshing = false;
    });
  }
  noteChildSpinVerdict(childId, noul) {
    if (!this.#children.has(childId))
      return;
    this.#ensureRoundPolicy().noteSpinVerdict(childId, noul);
  }
  #ensureSpinAttention() {
    if (this.#spinAttention === undefined) {
      this.#spinAttention = createSpinAttentionSource({
        enabledReader: () => this.#spinAttentionOn,
        onVerdict: (childId, score) => this.noteChildSpinVerdict(childId, score)
      });
    }
    return this.#spinAttention;
  }
  #tickSpinAttention() {
    const cap = this.#roundLimits.maxRounds;
    const views = [];
    for (const [childId, view] of this.#children) {
      if (view.status !== "running")
        continue;
      views.push({ childId, label: view.label, rounds: view.rounds, running: true, startedAt: view.startedAt });
    }
    if (views.length > 0)
      this.#ensureSpinAttention().tick(views, cap);
  }
  cancelChild(childId) {
    const agent = this.#childAgents.get(childId);
    if (agent?.cancel) {
      try {
        agent.cancel({ kind: "user" }, { keepInbox: true });
      } catch {
        try {
          agent.cancel({ kind: "user" });
        } catch {
          return this.#cancelViaService(childId);
        }
      }
      this.#settleChild(childId, "cancelled");
      return true;
    }
    return this.#cancelViaService(childId);
  }
  #cancelViaService(childId) {
    const service = this.#ctx.get?.("subagents");
    if (!service || typeof service.interruptByParent !== "function")
      return false;
    if (this.#sessionId === undefined)
      return false;
    try {
      service.interruptByParent(childId, this.#sessionId, "continuable");
    } catch (error) {
      console.error(`[host-session] subagents service force-stop rejected for ${childId.slice(0, 8)}: ${error instanceof Error ? error.message : error}`);
      return false;
    }
    this.#settleChild(childId, "cancelled");
    return true;
  }
  #onHardStop(record) {
    const variant = record.early === true ? "spin-detected early" : "grace exhausted";
    console.info(`[subagent-policy] force-stopped child ${record.childId} at round ${record.round} (cap ${record.cap} + grace ${record.grace}, ${variant})`);
  }
  childTranscript(id) {
    return [...this.#childLogs.get(id) ?? []];
  }
  subagentViews() {
    return [...this.#children.entries()].map(([id, v]) => ({
      id,
      label: v.label,
      status: v.status,
      rounds: v.rounds,
      ...v.injectedRound !== undefined ? { injectedRound: v.injectedRound } : {},
      ...v.hardStopRound !== undefined ? { hardStopRound: v.hardStopRound } : {},
      ...v.spinStopRound !== undefined ? { spinStopRound: v.spinStopRound } : {}
    }));
  }
  #subagentListeners = new Set;
  onSubagentViews(listener) {
    this.#subagentListeners.add(listener);
    listener(this.subagentViews());
    return () => this.#subagentListeners.delete(listener);
  }
  steerChild(id, text) {
    const agent = this.#childAgents.get(id);
    if (!agent?.steer)
      return false;
    try {
      agent.steer(createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } }));
      return true;
    } catch {
      return false;
    }
  }
  async steerChildDetailed(id, text) {
    const agent = this.#childAgents.get(id);
    if (agent?.steer) {
      try {
        agent.steer(createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } }));
        return { ok: true };
      } catch {}
    }
    if (this.#sessionId === undefined)
      return { ok: false, reason: "no live host session" };
    const service = this.#ctx.get?.("subagents");
    if (!service || typeof service.prompt !== "function") {
      return { ok: false, reason: "child agent not reachable and no subagents service" };
    }
    try {
      await service.prompt({
        requestId: randomUUID(),
        parentSessionId: this.#sessionId,
        childSessionId: id,
        mode: "continuable",
        delivery: "steer",
        content: [{ type: "text", text }]
      }, new AbortController().signal);
      return { ok: true };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`[host-session] subagents service steer rejected for ${id.slice(0, 8)}: ${reason}`);
      return { ok: false, reason };
    }
  }
  #adoptChild(session, sessionKey) {
    if (this.#children.has(sessionKey))
      return false;
    const header = session?.header;
    if (!header || String(header.parentSession) !== this.#sessionId)
      return false;
    if (header.origin !== "subagent" && (header.delegationDepth ?? 0) <= 0)
      return false;
    this.#children.set(sessionKey, {
      label: `subagent ${sessionKey.slice(0, 8)}`,
      status: "running",
      rounds: 0,
      startedAt: Date.now()
    });
    const agent = session?.agent;
    if (agent)
      this.#childAgents.set(sessionKey, agent);
    return true;
  }
  #registerChild(childId, label) {
    if (!childId)
      return;
    const existing = this.#children.get(childId);
    if (existing) {
      if (label && label !== existing.label)
        this.#children.set(childId, { ...existing, label });
    } else {
      this.#children.set(childId, { label: label || `subagent ${childId.slice(0, 8)}`, status: "running", rounds: 0, startedAt: Date.now() });
    }
    this.#emitChildren();
  }
  #settleChild(childId, outcome) {
    const existing = this.#children.get(childId);
    if (existing && existing.status === "running") {
      this.#children.set(childId, { ...existing, status: outcome });
      this.#emitChildren();
    }
  }
  #foldChildEvent(session, sessionKey, event) {
    let changed = this.#adoptChild(session, sessionKey);
    const view = this.#children.get(sessionKey);
    if (!view)
      return;
    const d = event.data ?? {};
    if (event.type === "subagent/descriptor") {
      const label = typeof d.label === "string" && d.label ? d.label : undefined;
      const model = [d.agentProvider, d.agentModel].filter(Boolean).join("/") || (typeof d.provider === "string" ? String(d.provider) : undefined);
      const next = { ...view, ...label ? { label } : {}, ...model ? { model } : {} };
      this.#children.set(sessionKey, next);
      changed = true;
    } else if (event.type === "request/header") {
      const cfg = d.header?.config ?? d.config;
      const model = cfg && (cfg.provider || cfg.model) ? `${cfg.provider ?? ""}/${cfg.model ?? ""}`.replace(/^\//, "") : undefined;
      if (model) {
        this.#children.set(sessionKey, { ...view, model });
        changed = true;
      }
    } else if (event.type === "assistant/message") {
      const text = blocksText(d.message?.content ?? d.content);
      const usage = d.usage?.totalTokens ?? d.message?.usage?.totalTokens ?? d.message?.usage?.total_tokens;
      const rounds = view.rounds + 1;
      this.#children.set(sessionKey, {
        ...view,
        rounds,
        ...usage ? { tokens: (view.tokens ?? 0) + Number(usage) } : {},
        ...text ? { lastLine: text.split(`
`).pop()?.slice(0, 80) } : {}
      });
      changed = true;
      this.#ensureRoundPolicy().onRoundCount(sessionKey, rounds, this.#children.get(sessionKey)?.label);
      this.#refreshRoundLimits();
      this.#tickSpinAttention();
    }
    const log = this.#childLogs.get(sessionKey) ?? [];
    if (event.type === "assistant/message") {
      const text = blocksText(d.message?.content ?? d.content);
      for (const line of text.split(`
`))
        if (line.trim())
          log.push(line.slice(0, 110));
    } else if (event.type === "tool/call") {
      log.push(`▶ ${d.name ?? "tool"} ${String(d.arguments ?? "").slice(0, 90)}`);
    } else if (event.type === "tool/result") {
      log.push("  ⎿ done");
    }
    while (log.length > 200)
      log.shift();
    if (log.length > 0)
      this.#childLogs.set(sessionKey, log);
    if (changed)
      this.#emitChildren();
  }
  #emitChildren() {
    for (const listener of this.#subagentListeners) {
      try {
        listener(this.subagentViews());
      } catch {}
    }
    const cb = this.#cb;
    if (!cb?.onSubagentUpdate)
      return;
    const clamp = (v) => v && v.length > 240 ? v.slice(-240) : v;
    cb.onSubagentUpdate([...this.#children.entries()].map(([id, v]) => ({
      id,
      label: v.label,
      ...v.model ? { model: v.model } : {},
      status: v.status,
      rounds: v.rounds,
      ...v.tokens !== undefined ? { tokens: v.tokens } : {},
      elapsed: Math.max(0, Math.floor((Date.now() - v.startedAt) / 1000)),
      ...v.lastLine ? { lastLine: clamp(v.lastLine) } : {},
      ...v.injectedRound !== undefined ? { injectedRound: v.injectedRound } : {},
      ...v.hardStopRound !== undefined ? { hardStopRound: v.hardStopRound } : {},
      ...v.spinStopRound !== undefined ? { spinStopRound: v.spinStopRound } : {}
    })));
  }
  historyTurns() {
    const events = this.#snapshot();
    const turns = [];
    let open;
    for (const event of events) {
      if (event.type === "turn/start") {
        open = { turn: Number(event.data?.turn ?? turns.length), seqEnd: Number(event.seq ?? 0), preview: "" };
        continue;
      }
      if (!open)
        continue;
      if (event.type === "user/message") {
        const kind = event.data?.source?.kind;
        if (kind === undefined || kind === "user") {
          const text = blocksText(event.data?.content);
          if (text && !open.preview)
            open.preview = text;
        }
      } else if (event.type === "turn/end") {
        open.seqEnd = Number(event.seq ?? open.seqEnd);
        turns.push(open);
        open = undefined;
      }
    }
    return turns;
  }
  #snapshot() {
    const session = this.#handle?.agent?.session;
    const snap = session?.snapshotEvents?.();
    return Array.isArray(snap) ? snap : [];
  }
  async forkAtTurn(seqEnd) {
    const events = this.#snapshot();
    if (events.length === 0)
      throw new Error("no live session to fork");
    const seed = events.slice(0, seqEnd + 1);
    if (seed.length === 0)
      throw new Error("fork point before the first event");
    const parentSession = this.#sessionId;
    const sel = this.#modelSelection();
    this.#disarmIdleRelease();
    this.#releasedSeq = 0;
    try {
      this.#handle?.dispose?.();
    } catch {}
    this.#handle = undefined;
    this.#agentId = undefined;
    this.#sessionId = randomUUID();
    this.#children.clear();
    this.#runSeqToChild.clear();
    this.#toolCalls.clear();
    this.#handle = await this.#ctx.agents.create({
      sessionId: this.#sessionId,
      meta: { cwd: process.cwd(), ...parentSession ? { parentSession, isSeeded: true } : {} },
      ...seed ? { seed, inheritedEventCount: seed.length } : {},
      ...sel ? { agentOptions: sel } : {}
    });
    this.#agentId = this.#handle.agent.id;
    const items = [];
    for (const event of seed) {
      if (event.type === "user/message") {
        const kind = event.data?.source?.kind;
        if (kind !== undefined && kind !== "user")
          continue;
        const text = blocksText(event.data?.content);
        if (text)
          items.push({ kind: "user", text });
      } else if (event.type === "assistant/message") {
        const text = blocksText(event.data?.message?.content);
        if (text)
          items.push({ kind: "assistant", text });
      }
    }
    return { items, turn: seed.length };
  }
  #modelSelection() {
    const sel = this.#override ?? this.#ctx.get?.("agentDefaultModel")?.currentSelection?.();
    if (!sel)
      return;
    if (this.#handle === undefined)
      this.label = `${sel.provider}/${sel.model}${sel.reasoningEffort ? ` (${sel.reasoningEffort})` : ""}`;
    return { provider: sel.provider, model: sel.model, ...sel.reasoningEffort ? { reasoningEffort: sel.reasoningEffort } : {} };
  }
  async attachImage(path) {
    const store = this.#ctx.get?.("attachments");
    if (!store?.saveImages)
      throw new Error("attachment service unavailable in this host");
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    const mediaType = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
    if (!mediaType[ext])
      throw new Error(`unsupported image type .${ext} (png/jpg/webp/gif)`);
    const data = await (await import("node:fs/promises")).readFile(path);
    const [ref] = await store.saveImages([{ data: new Uint8Array(data), mediaType: mediaType[ext], name: path.split("/").pop() }]);
    this.#pendingImages.push(ref);
    return `${ref.name ?? path} (${(ref.bytes / 1024).toFixed(0)} KB)`;
  }
  abort() {
    this.#disarmIdleRelease();
    try {
      this.#handle?.dispose?.();
    } catch {}
    this.#handle = undefined;
    this.#agentId = undefined;
    this.#sessionId = undefined;
    this.#releasedSeq = 0;
    this.#resolveTurn?.();
    this.#resolveTurn = undefined;
  }
  steer(userText) {
    if (!this.#handle)
      return;
    const message = createUserMessage({
      content: [{ type: "text", text: userText }],
      source: { kind: "user" }
    });
    this.#handle.agent.steer?.(message);
  }
  #finishTurn() {
    DBG("finishTurn");
    const endedAt = Date.now();
    this.#ticker.finish();
    const chars = this.#ticker.chars();
    const ms = Math.max(0, endedAt - this.#turnStartedAt);
    const completion = this.usage.completion - this.#turnUsageStart.completion;
    const real = completion > 0;
    const tokens = real ? completion : estimateTokens(chars);
    if (this.#firstDeltaAt > 0) {
      const decodeMs = Math.max(0, (this.#lastDeltaAt || endedAt) - this.#firstDeltaAt);
      if (decodeMs > 0) {
        this.#lastDecode = { tokens, ms: decodeMs };
        this.#decodeTotals.tokens += tokens;
        this.#decodeTotals.ms += decodeMs;
      }
    }
    this.#firstDeltaAt = 0;
    this.#lastDeltaAt = 0;
    this.lastTurnStats = {
      startedAt: this.#turnStartedAt,
      endedAt,
      ms,
      chars,
      tokens,
      tps: tokensPerSecond(tokens, ms),
      estimated: !real
    };
    const r = this.#resolveTurn;
    this.#resolveTurn = undefined;
    this.#cb?.onTurnEnd({ prompt: this.usage.prompt, completion: this.usage.completion });
    this.#armIdleRelease();
    r?.();
  }
  #wire() {
    const ctx = this.#ctx;
    ctx.on("agent/assistant-stream", ({ agent, frame }) => {
      if (frame.type === "chunk" && frame.chunk?.type === "text-delta" && frame.chunk.text && agent.id !== this.#agentId) {
        const view = this.#children.get(agent.id);
        if (view && view.status === "running") {
          this.#children.set(agent.id, { ...view, lastLine: (view.lastLine ?? "") + frame.chunk.text });
          this.#emitChildren();
        }
      }
      if (this.#agentId === undefined || agent.id !== this.#agentId)
        return;
      const cb = this.#cb;
      if (!cb || frame.type !== "chunk" || !frame.chunk)
        return;
      const c = frame.chunk;
      if (process.env.DSH_OPENTUI_DEBUG) {
        try {
          appendFileSync("/tmp/otui-stream.log", `${Date.now()} ${c.type} ${(c.text ?? "").length}ch
`);
        } catch {}
      }
      try {
        if (c.type === "reasoning-delta" && c.text) {
          cb.onThinkingDelta(c.text);
          this.#noteDelta();
          this.#ticker.add(c.text.length);
        } else if (c.type === "text-delta" && c.text) {
          cb.onContentDelta(c.text);
          this.#noteDelta();
          this.#ticker.add(c.text.length);
        } else if (c.type === "usage") {
          if (process.env.DSH_OPENTUI_DEBUG) {
            try {
              appendFileSync("/tmp/otui-usage.log", JSON.stringify(c) + `
`);
            } catch {}
          }
          const u = c.usage ?? {};
          const num = (v) => typeof v === "number" ? v : 0;
          let p = Math.max(num(u.promptTokens), num(u.inputTokens), num(u.prompt_tokens));
          let comp = Math.max(num(u.completionTokens), num(u.outputTokens), num(u.completion_tokens));
          const cRead = Math.max(num(u.cacheReadTokens), num(u.cache_read_tokens), num(u.cacheRead));
          const cWrite = Math.max(num(u.cacheWriteTokens), num(u.cache_write_tokens), num(u.cacheWrite));
          if (p > 0)
            this.usage.prompt = p;
          if (comp > 0)
            this.usage.completion += comp;
          if (cRead > 0)
            this.usage.cacheRead = cRead;
          if (cWrite > 0)
            this.usage.cacheWrite = cWrite;
          if (p > 0)
            this.#cachePromptTotal += p;
          if (cRead > 0)
            this.#cacheReadTotal += cRead;
          if (cWrite > 0)
            this.#cacheWriteTotal += cWrite;
          const billed = p + cRead + cWrite;
          if (billed > 0)
            this.#lastMessageCacheHitRate = cRead / billed * 100;
        } else if (c.type === "tool-call-delta" && c.name) {}
      } catch {}
    });
    ctx.on("agent/status", ({ agent, status }) => {
      if (this.#agentId === undefined || agent.id !== this.#agentId)
        return;
      const wasRunning = this.#running;
      this.#running = status === "running";
      DBG(`agent/status ${status} wasRunning=${wasRunning} resolve=${!!this.#resolveTurn}`);
      if (wasRunning && !this.#running && this.#resolveTurn)
        this.#finishTurn();
    });
    ctx.on("session/event", (session, event) => {
      if (process.env.DSH_OPENTUI_DEBUG && (event.type === "turn/end" || event.type === "turn/start")) {
        try {
          process.stderr.write(`[hs] session/event ${event.type} sessionMatch=${String(session.id) === this.#sessionId} my=${this.#sessionId}
`);
        } catch {}
      }
      const sessionKey = String(session.id);
      if (this.#sessionId === undefined)
        return;
      if (sessionKey !== this.#sessionId) {
        this.#foldChildEvent(session, sessionKey, event);
        return;
      }
      this.#emitJournal(event);
      const cb = this.#cb;
      if (!cb)
        return;
      try {
        if (event.type === "tool/call" && event.data) {
          const callId = String(event.data.callId ?? "");
          const name = String(event.data.name ?? "tool");
          const args = String(event.data.arguments ?? "");
          this.#toolCalls.set(callId, { name, args });
          cb.onToolStart?.({ callId, name, args });
        } else if (event.type === "todo/write") {
          cb.onTodos?.(event.data?.todos ?? []);
        } else if (event.type === "tool-workflow/agent-start" && event.data) {
          this.#registerChild(String(event.data.childId ?? ""), String(event.data.label ?? "subagent"));
          this.#runSeqToChild.set(`${event.data.runId}:${event.data.seq}`, String(event.data.childId ?? ""));
        } else if (event.type === "tool-workflow/agent-end" && event.data) {
          const childId = this.#runSeqToChild.get(`${event.data.runId}:${event.data.seq}`);
          const outcome = event.data.outcome === "failed" || event.data.outcome === "cancelled" ? event.data.outcome : "completed";
          if (childId)
            this.#settleChild(childId, outcome);
        } else if (event.type === "tool/result" && event.data) {
          const callId = String(event.data.callId ?? event.data.message?.toolCallId ?? "");
          const known = this.#toolCalls.get(callId);
          const brief = JSON.stringify(event.data.output ?? event.data).slice(0, 300);
          const content = event.data.message?.content ?? event.data.content ?? [];
          const imageBlock = content.find?.((c) => c?.type === "image");
          const pathMatch = /<path>([^<]+)<\/path>/.exec(content.find?.((c) => c?.type === "text")?.text ?? "");
          const imagePath = (typeof imageBlock?.source === "string" ? imageBlock.source : undefined) ?? imageBlock?.path ?? imageBlock?.file_path ?? imageBlock?.url ?? (imageBlock ? pathMatch?.[1] : undefined);
          cb.onToolRun({
            name: known?.name ?? "tool",
            argsPretty: known?.args ?? "",
            output: brief,
            ok: event.data.isError !== true,
            ...callId ? { callId } : {},
            ...typeof imagePath === "string" ? { imagePath } : {}
          });
        } else if (event.type === "turn/end") {
          DBG(`turn/end seen resolve=${!!this.#resolveTurn}`);
          const reason = event.data?.reason;
          if (reason?.kind === "error") {
            cb.onError(String(reason.error?.message ?? reason.error ?? "turn error").slice(0, 300));
          }
          if (this.#resolveTurn)
            this.#finishTurn();
        }
      } catch {}
    });
    ctx.on("approval/request", async (request, next) => {
      if (this.#sessionId === undefined || String(request?.agent?.session?.id) !== this.#sessionId)
        return next();
      const cb = this.#cb;
      if (!cb)
        return "unavailable";
      let args = {};
      try {
        const raw = this.#lookupCallArgs(request) ?? "";
        if (raw)
          args = JSON.parse(raw);
      } catch {}
      const ok = await cb.onApprove(String(request.toolName ?? "tool"), args);
      return ok ? "allowed-once" : "rejected";
    });
  }
  #lookupCallArgs(request) {
    if (!request?.callId)
      return;
    const session = request.agent?.session;
    if (typeof session?.eventAt !== "function")
      return;
    for (let seq = (session.seq ?? 0) - 1;seq >= 0; seq--) {
      const event = session.eventAt(seq);
      if (event?.type === "tool/call" && String(event.data?.callId ?? "") === String(request.callId)) {
        return event.data?.arguments;
      }
    }
    return;
  }
}

// src/client/remote-follow.ts
function turnEndErrorMessage(data) {
  const reason = asRecord(data.reason);
  if (reason.kind !== "error")
    return;
  const error = asRecord(reason.error);
  const message = error.message ?? reason.error;
  return String(message ?? "turn error").slice(0, 300);
}
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

// ../tui-base/src/routes/session/subagent-markers.ts
import { createSignal } from "solid-js";
var [subagentViews, setSubagentViews] = createSignal([]);
function foldSubagentMarkerViews(views) {
  setSubagentViews(views);
}

// src/host-session-seam-adapter.ts
class HostSessionSeam {
  #session;
  #listeners = [];
  #turnInFlight = false;
  #unjournal;
  constructor(session) {
    this.#session = session;
  }
  status() {
    return {
      connection: "connected",
      turn: this.#turnInFlight ? "running" : "idle",
      sessionAttached: this.#session.currentSessionId() !== undefined
    };
  }
  async listSessions(limit) {
    const rows = await this.#session.listSessions(limit);
    return rows.map((row) => ({ id: row.id, title: row.title, ...row.updatedAt !== undefined ? { updatedAt: row.updatedAt } : {} }));
  }
  async searchSessions(query) {
    return this.#session.searchSessions(query);
  }
  async storedTranscript(id, skip) {
    const rows = await this.#session.storedTranscript(id, skip);
    return rows.map((row) => ({ kind: row.kind, text: row.text, final: true }));
  }
  currentSessionId() {
    return this.#session.currentSessionId();
  }
  cacheHitRate(mode) {
    return this.#session.cacheHitRate(mode);
  }
  configLoad() {
    return this.#session.configLoad();
  }
  configSave(patch) {
    return this.#session.configSave(patch);
  }
  btwAsk(question, snapshot, onDelta) {
    return this.#session.btwAsk(question, snapshot, onDelta);
  }
  plugins() {
    return this.#session.listPlugins();
  }
  async sessionInfo() {
    const base = this.#session.sessionInfo();
    if (base.sessionId === undefined)
      return;
    let messageCount = 0;
    try {
      const rows = await this.#session.storedTranscript(base.sessionId);
      messageCount = rows.filter((row) => row.kind === "user" || row.kind === "assistant").length;
    } catch {}
    return { ...base, sessionId: base.sessionId, model: base.model ?? null, messageCount };
  }
  subagentViews() {
    return this.#session.subagentViews();
  }
  onSubagentViews(listener) {
    foldSubagentMarkerViews(this.#session.subagentViews());
    return this.#session.onSubagentViews((views) => {
      foldSubagentMarkerViews(views);
      listener(views);
    });
  }
  resumeSession(id) {
    return this.#session.resumeSession(id);
  }
  newSession() {
    this.#session.newSession();
  }
  async renameSession(_title) {
    return;
  }
  async turn(userText, cb) {
    this.#turnInFlight = true;
    try {
      await this.#session.turn(userText, {
        onThinkingDelta: (text) => cb.onThinkingDelta(text),
        onContentDelta: (text) => cb.onContentDelta(text),
        onTurnEnd: () => {},
        onApprove: async (name, args) => await cb.onApprove(name, args) === "allowed-once",
        onToolStart: (start) => cb.onToolStart?.(start),
        onToolRun: () => {},
        onError: (message) => cb.onError(message)
      });
    } finally {
      this.#turnInFlight = false;
    }
  }
  steer(text) {
    this.#session.steer(text);
  }
  interrupt() {
    this.#session.abort();
  }
  registerAskProvider(onAsk) {
    this.#session.registerAskProvider(async (questions) => onAsk(questions));
  }
  async listProviders() {
    return this.#session.listProviders();
  }
  async modelCatalog(_force) {
    const providers = await this.#session.listProviders();
    const rows = [];
    for (const provider of providers) {
      for (const modelID of provider.models)
        rows.push({ providerID: provider.provider, modelID });
    }
    return rows;
  }
  async currentModelSelection() {
    const selection = this.#session.currentModelSelection();
    if (!selection)
      return;
    return { providerID: selection.provider, modelID: selection.model };
  }
  selectModel(providerID, modelID) {
    try {
      this.#session.switchModel(providerID, modelID);
    } catch (error) {
      console.error("[host-session-seam-adapter] selectModel failed:", error);
    }
  }
  thinking = {
    efforts: () => this.#session.currentModelEfforts(),
    currentEffort: async () => this.#session.currentModelSelection()?.reasoningEffort,
    selectEffort: (effort) => {
      const selection = this.#session.currentModelSelection();
      if (!selection)
        return;
      try {
        this.#session.switchModel(selection.provider, selection.model, effort || undefined);
      } catch (error) {
        console.error("[host-session-seam-adapter] selectEffort failed:", error);
      }
    }
  };
  usageSummary() {
    return this.#session.usageSummary();
  }
  onSessionEvent(listener) {
    this.#listeners.push(listener);
    this.#ensureJournalFeed();
    return () => {
      const index = this.#listeners.indexOf(listener);
      if (index >= 0)
        this.#listeners.splice(index, 1);
    };
  }
  async dispose() {
    this.#unjournal?.();
    this.#unjournal = undefined;
    this.#listeners.length = 0;
  }
  #ensureJournalFeed() {
    if (this.#unjournal !== undefined)
      return;
    const hook = this.#session;
    if (typeof hook.onJournalRecord !== "function")
      return;
    this.#unjournal = hook.onJournalRecord((entry) => {
      if (this.#turnInFlight)
        return;
      for (const event of projectJournalRecord(entry, this.#session.currentSessionId() ?? "")) {
        this.#emit(event);
      }
    });
  }
  #emit(event) {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {}
    }
  }
}
function projectJournalRecord(entry, sessionId) {
  if (entry.type === "user/message") {
    const text = blocksText2(entry.data.content);
    if (!text)
      return [];
    const id = typeof entry.data.messageID === "string" ? entry.data.messageID : `journal-${entry.seq}`;
    return [{ type: "message.updated", details: { id, role: "user", text, sessionID: sessionId } }];
  }
  if (entry.type === "assistant/message") {
    const text = assistantTextValue(entry.data);
    if (!text)
      return [];
    const messageID = typeof entry.data.messageID === "string" ? entry.data.messageID : `journal-${entry.seq}`;
    return [
      {
        type: "message.part.updated",
        details: { messageID, sessionID: sessionId, part: { type: "text", id: `${messageID}:text`, text } }
      }
    ];
  }
  if (entry.type === "turn/end") {
    const message = turnEndErrorMessage(entry.data);
    if (message === undefined)
      return [];
    return [{ type: "session.error", details: { message, sessionID: sessionId } }];
  }
  return [];
}
function blocksText2(content) {
  const blocks = Array.isArray(content) ? content : [];
  let text = "";
  for (const block of blocks) {
    if (typeof block === "object" && block !== null && block.type === "text") {
      const value = block.text;
      if (typeof value === "string")
        text += value;
    }
  }
  return text.trim();
}
function assistantTextValue(data) {
  const message = typeof data.message === "object" && data.message !== null ? data.message : undefined;
  if (message && Array.isArray(message.content) && blocksText2(message.content))
    return blocksText2(message.content);
  if (typeof data.text === "string")
    return data.text.trim();
  return blocksText2(data.content ?? data.parts);
}

// ../tui-base/src/routes/session/session-composer.tsx
import { insert as _$insert } from "@opentui/solid";
import { createComponent as _$createComponent5 } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { use as _$use } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { createSignal as createSignal4, onCleanup as onCleanup4, Show as Show2 } from "solid-js";
import { useRenderer as useRenderer2 } from "@opentui/solid";
import { measureEditText } from "@opentui/core";

// ../tui-base/src/ui/border.ts
var EmptyBorder = {
  topLeft: "",
  bottomLeft: "",
  vertical: "",
  topRight: "",
  bottomRight: "",
  horizontal: " ",
  bottomT: "",
  topT: "",
  cross: "",
  leftT: "",
  rightT: ""
};
var SplitBorder = {
  border: ["left", "right"],
  customBorderChars: {
    ...EmptyBorder,
    vertical: "┃"
  }
};

// ../tui-base/src/routes/session/composer-state.ts
var MAX_HISTORY_ENTRIES = 50;

class ComposerHistory {
  entries = [];
  index = 0;
  move(direction, input) {
    if (this.entries.length === 0)
      return;
    const current = this.entries.at(this.index);
    if (current === undefined)
      return;
    if (current !== input && input.length > 0)
      return;
    const next = this.index + direction;
    if (Math.abs(next) > this.entries.length || next > 0)
      return;
    this.index = next;
    if (next === 0)
      return "";
    return this.entries.at(next);
  }
  append(text) {
    if (this.entries.at(-1) === text) {
      this.index = 0;
      return;
    }
    this.entries.push(text);
    if (this.entries.length > MAX_HISTORY_ENTRIES)
      this.entries = this.entries.slice(-MAX_HISTORY_ENTRIES);
    this.index = 0;
  }
  get size() {
    return this.entries.length;
  }
}

class ComposerController {
  history;
  send;
  steer;
  onBusyChange;
  busyState = false;
  pendingTurn;
  constructor(options) {
    this.send = options.send;
    this.steer = options.steer;
    this.onBusyChange = options.onBusyChange;
    this.history = options.history ?? new ComposerHistory;
  }
  get busy() {
    return this.busyState;
  }
  submit(text) {
    const prompt = text.trim();
    if (!prompt)
      return "ignored";
    this.history.append(prompt);
    if (this.busyState) {
      this.steer(prompt);
      return "steered";
    }
    this.setBusy(true);
    this.pendingTurn = this.send(prompt).catch(() => {
      return;
    }).finally(() => {
      this.pendingTurn = undefined;
      this.setBusy(false);
    });
    return "sent";
  }
  get turn() {
    return this.pendingTurn;
  }
  setBusy(busy) {
    if (this.busyState === busy)
      return;
    this.busyState = busy;
    this.onBusyChange?.(busy);
  }
}
// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/Pipeable.js
var pipeArguments = (self, args) => {
  switch (args.length) {
    case 0:
      return self;
    case 1:
      return args[0](self);
    case 2:
      return args[1](args[0](self));
    case 3:
      return args[2](args[1](args[0](self)));
    case 4:
      return args[3](args[2](args[1](args[0](self))));
    case 5:
      return args[4](args[3](args[2](args[1](args[0](self)))));
    case 6:
      return args[5](args[4](args[3](args[2](args[1](args[0](self))))));
    case 7:
      return args[6](args[5](args[4](args[3](args[2](args[1](args[0](self)))))));
    case 8:
      return args[7](args[6](args[5](args[4](args[3](args[2](args[1](args[0](self))))))));
    case 9:
      return args[8](args[7](args[6](args[5](args[4](args[3](args[2](args[1](args[0](self)))))))));
    default: {
      let ret = self;
      for (let i = 0, len = args.length;i < len; i++) {
        ret = args[i](ret);
      }
      return ret;
    }
  }
};
var Prototype = {
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var Class = /* @__PURE__ */ function() {
  function PipeableBase() {}
  PipeableBase.prototype = Prototype;
  return PipeableBase;
}();

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/Function.js
var dual = function(arity, body) {
  if (typeof arity === "function") {
    return function() {
      return arity(arguments) ? body.apply(this, arguments) : (self) => body(self, ...arguments);
    };
  }
  switch (arity) {
    case 0:
    case 1:
      throw new RangeError(`Invalid arity ${arity}`);
    case 2:
      return function(a, b) {
        if (arguments.length >= 2) {
          return body(a, b);
        }
        return function(self) {
          return body(self, a);
        };
      };
    case 3:
      return function(a, b, c) {
        if (arguments.length >= 3) {
          return body(a, b, c);
        }
        return function(self) {
          return body(self, a, b);
        };
      };
    default:
      return function() {
        if (arguments.length >= arity) {
          return body.apply(this, arguments);
        }
        const args = arguments;
        return function(self) {
          return body(self, ...args);
        };
      };
  }
};
var identity = (a) => a;
var constant = (value) => () => value;
var constTrue = /* @__PURE__ */ constant(true);
var constUndefined = /* @__PURE__ */ constant(undefined);
var constVoid = constUndefined;
function memoize(f) {
  const cache = new WeakMap;
  return (a) => {
    const cached = cache.get(a);
    if (cached !== undefined)
      return cached;
    const result = f(a);
    cache.set(a, result);
    return result;
  };
}
function memoizeIdempotent(f) {
  const cache = new WeakMap;
  return (a) => {
    const cached = cache.get(a);
    if (cached !== undefined)
      return cached;
    const result = f(a);
    cache.set(a, result);
    if (result !== a) {
      cache.set(result, result);
    }
    return result;
  };
}

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/internal/equal.js
var getAllObjectKeys = (obj) => {
  const keys = new Set(Reflect.ownKeys(obj));
  if (obj.constructor === Object)
    return keys;
  if (obj instanceof Error) {
    keys.delete("stack");
  }
  const proto = Object.getPrototypeOf(obj);
  let current = proto;
  while (current !== null && current !== Object.prototype) {
    const ownKeys = Reflect.ownKeys(current);
    for (let i = 0;i < ownKeys.length; i++) {
      keys.add(ownKeys[i]);
    }
    current = Object.getPrototypeOf(current);
  }
  if (keys.has("constructor") && typeof obj.constructor === "function" && proto === obj.constructor.prototype) {
    keys.delete("constructor");
  }
  return keys;
};
var byReferenceInstances = /* @__PURE__ */ new WeakSet;
var viewBytes = (view) => new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
var isArrayBufferLike2 = (u) => u instanceof ArrayBuffer || typeof SharedArrayBuffer !== "undefined" && u instanceof SharedArrayBuffer;
var bufferBytes = (buffer) => {
  try {
    return new Uint8Array(buffer);
  } catch {
    return;
  }
};

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/internal/hash.js
var backEdges = 0;
var addBackEdge = () => {
  backEdges++;
};

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/Predicate.js
function isString(input) {
  return typeof input === "string";
}
function isNumber(input) {
  return typeof input === "number";
}
function isBoolean(input) {
  return typeof input === "boolean";
}
function isSymbol(input) {
  return typeof input === "symbol";
}
function isPropertyKey(u) {
  return isString(u) || isNumber(u) || isSymbol(u);
}
function isFunction(input) {
  return typeof input === "function";
}
function isNotNullish(input) {
  return input != null;
}
function isUnknown(_) {
  return true;
}
function isObjectKeyword(input) {
  return typeof input === "object" && input !== null || isFunction(input);
}
var hasProperty = /* @__PURE__ */ dual(2, (self, property) => isObjectKeyword(self) && (property in self));

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/Hash.js
var symbol = "~effect/Hash";
var hash = (self) => {
  switch (typeof self) {
    case "number":
      return number(self);
    case "bigint":
      return string(self.toString(10));
    case "string":
      return string(self);
    case "function":
    case "object": {
      if (self === null) {
        break;
      } else if (self instanceof Date) {
        if (Number.isNaN(self.getTime())) {
          return string("Invalid Date");
        }
        return string(self.toISOString());
      } else if (self instanceof RegExp) {
        return string(self.toString());
      } else {
        if (byReferenceInstances.has(self)) {
          return random(self);
        }
        const cached = hashCache.get(self);
        if (cached !== undefined) {
          return cached;
        }
        if (visitedObjects.has(self)) {
          addBackEdge();
          return string("[Circular]");
        }
        visitedObjects.add(self);
        const seen = backEdges;
        let h;
        try {
          if (symbol in self) {
            h = self[symbol]();
          } else if (typeof self === "function") {
            h = random(self);
          } else if (isArrayBufferLike2(self)) {
            const bytes = bufferBytes(self);
            h = bytes === undefined ? random(self) : array(bytes);
          } else if (self instanceof DataView) {
            h = array(viewBytes(self));
          } else if (Array.isArray(self) || ArrayBuffer.isView(self)) {
            h = array(self);
          } else if (self instanceof Map) {
            h = hashMap(self);
          } else if (self instanceof Set) {
            h = hashSet(self);
          } else {
            h = structure(self);
          }
        } finally {
          visitedObjects.delete(self);
        }
        if (seen === backEdges) {
          hashCache.set(self, h);
        }
        return h;
      }
    }
  }
  return optimize(mix(string(String(self))));
};
var random = (self) => {
  if (!randomHashCache.has(self)) {
    randomHashCache.set(self, optimize(Math.random() * 4294967296 | 0));
  }
  return randomHashCache.get(self);
};
var mix = (h) => {
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  return h ^ h >>> 16;
};
var combine = /* @__PURE__ */ dual(2, (self, b) => mix(Math.imul(self, 2654435761) + Math.imul(b, 2246822507)));
var optimize = (n) => n & 3221225471 | n >>> 1 & 1073741824;
var float64 = /* @__PURE__ */ new DataView(/* @__PURE__ */ new ArrayBuffer(8));
var number = (n) => {
  const h = n | 0;
  if (h === n) {
    return optimize(h);
  }
  float64.setFloat64(0, n !== n ? NaN : n);
  return optimize(combine(float64.getInt32(0), float64.getInt32(4)));
};
var string = (str) => {
  let h = 5381, i = str.length;
  while (i) {
    h = h * 33 ^ str.charCodeAt(--i);
  }
  return optimize(h);
};
var structureKeys = (o, keys) => {
  let h = 12289;
  for (const key of keys) {
    h ^= combine(hash(key), hash(o[key]));
  }
  return optimize(h);
};
var structure = (o) => structureKeys(o, getAllObjectKeys(o));
var unordered = (seed, f) => (iter) => {
  let h = seed;
  for (const element of iter) {
    h ^= f(element);
  }
  return optimize(h);
};
var array = (arr) => {
  let h = 6151;
  for (const element of arr) {
    h = combine(h, hash(element));
  }
  return optimize(h);
};
var hashMap = /* @__PURE__ */ unordered(/* @__PURE__ */ string("Map"), ([k, v]) => combine(hash(k), hash(v)));
var setSeed = /* @__PURE__ */ string("Set");
var hashSet = /* @__PURE__ */ unordered(setSeed, (element) => combine(setSeed, hash(element)));
var randomHashCache = /* @__PURE__ */ new WeakMap;
var hashCache = /* @__PURE__ */ new WeakMap;
var visitedObjects = /* @__PURE__ */ new WeakSet;

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/Equal.js
var symbol2 = "~effect/Equal";
function equals() {
  if (arguments.length === 1) {
    return (self) => compareBoth(self, arguments[0]);
  }
  return compareBoth(arguments[0], arguments[1]);
}
function compareBoth(self, that) {
  if (self === that)
    return true;
  if (self == null || that == null)
    return false;
  const selfType = typeof self;
  if (selfType !== typeof that) {
    return false;
  }
  if (selfType === "number" && self !== self && that !== that) {
    return true;
  }
  if (selfType !== "object" && selfType !== "function") {
    return false;
  }
  if (byReferenceInstances.has(self) || byReferenceInstances.has(that)) {
    return false;
  }
  return compareObjects(self, that);
}
function compareObjects(self, that) {
  const depth = pathLeft.length;
  for (let i = depth;i-- > 0; ) {
    if (pathLeft[i] === self && pathRight[i] === that)
      return true;
  }
  if (depth)
    return compareOnPath(self, that);
  let known = results.get(self);
  if (!known)
    results.set(self, known = new WeakMap);
  let result = known.get(that);
  if (result === undefined)
    known.set(that, result = compareOnPath(self, that));
  return result;
}
function compareOnPath(self, that) {
  pathLeft.push(self);
  pathRight.push(that);
  try {
    return compareStructure(self, that);
  } finally {
    pathLeft.pop();
    pathRight.pop();
  }
}
var pathLeft = [];
var pathRight = [];
var results = /* @__PURE__ */ new WeakMap;
function compareStructure(self, that) {
  if (hash(self) !== hash(that)) {
    return false;
  } else if (self instanceof Date) {
    if (!(that instanceof Date))
      return false;
    const selfTime = self.getTime();
    const thatTime = that.getTime();
    return selfTime === thatTime || Number.isNaN(selfTime) && Number.isNaN(thatTime);
  } else if (self instanceof RegExp) {
    return that instanceof RegExp && self.toString() === that.toString();
  }
  const bothEquals = isEqual(self);
  if (bothEquals !== isEqual(that) || typeof self === "function" && !bothEquals) {
    return false;
  } else if (bothEquals) {
    return self[symbol2](that);
  } else if (Array.isArray(self)) {
    if (!Array.isArray(that) || self.length !== that.length) {
      return false;
    }
    return compareArrays(self, that);
  } else if (isArrayBufferLike2(self)) {
    if (!isArrayBufferLike2(that) || self instanceof ArrayBuffer !== that instanceof ArrayBuffer) {
      return false;
    }
    const selfBytes = bufferBytes(self);
    const thatBytes = bufferBytes(that);
    return selfBytes !== undefined && thatBytes !== undefined && compareTypedArrays(selfBytes, thatBytes);
  } else if (ArrayBuffer.isView(self)) {
    const selfIsDataView = self instanceof DataView;
    if (!ArrayBuffer.isView(that) || self.byteLength !== that.byteLength || selfIsDataView !== that instanceof DataView) {
      return false;
    }
    if (selfIsDataView) {
      return compareTypedArrays(viewBytes(self), viewBytes(that));
    }
    return compareTypedArrays(self, that);
  } else if (self instanceof Map) {
    if (!(that instanceof Map) || self.size !== that.size) {
      return false;
    }
    return compareHashed(self, that, entryHash, equalEntries);
  } else if (self instanceof Set) {
    if (!(that instanceof Set) || self.size !== that.size) {
      return false;
    }
    return compareHashed(self, that, hash, compareBoth);
  }
  return compareRecords(self, that);
}
function compareArrays(self, that) {
  for (let i = 0;i < self.length; i++) {
    if (!compareBoth(self[i], that[i])) {
      return false;
    }
  }
  return true;
}
function compareTypedArrays(self, that) {
  if (self.length !== that.length) {
    return false;
  }
  for (let i = 0;i < self.length; i++) {
    if (self[i] !== that[i]) {
      return false;
    }
  }
  return true;
}
function compareRecords(self, that) {
  const selfKeys = getAllObjectKeys(self);
  const thatKeys = getAllObjectKeys(that);
  if (selfKeys.size !== thatKeys.size) {
    return false;
  }
  for (const key of selfKeys) {
    if (!thatKeys.has(key) || !compareBoth(self[key], that[key])) {
      return false;
    }
  }
  return true;
}
function compareHashed(self, that, hashOf, equivalent) {
  const groups = new Map;
  let remaining = 0;
  for (const item of that) {
    const h = hashOf(item);
    const group = groups.get(h);
    if (group)
      group.push(item);
    else
      groups.set(h, [item]);
    remaining++;
  }
  outer:
    for (const item of self) {
      const group = groups.get(hashOf(item));
      if (group) {
        for (let i = 0;i < group.length; i++) {
          if (equivalent(item, group[i])) {
            group[i] = group[group.length - 1];
            group.pop();
            remaining--;
            continue outer;
          }
        }
      }
      return false;
    }
  return remaining === 0;
}
var entryHash = (entry) => hash(entry[0]);
var equalEntries = (self, that) => compareBoth(self[0], that[0]) && compareBoth(self[1], that[1]);
var isEqual = (u) => hasProperty(u, symbol2);

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/Redactable.js
var symbolRedactable = /* @__PURE__ */ Symbol.for("~effect/Redactable");
var isRedactable = (u) => hasProperty(u, symbolRedactable);
function redact(u) {
  if (isRedactable(u))
    return getRedacted(u);
  return u;
}
function getRedacted(redactable) {
  return redactable[symbolRedactable](globalThis[currentFiberTypeId]?.context ?? emptyContext);
}
var currentFiberTypeId = "~effect/Fiber/currentFiber";
var emptyMap = /* @__PURE__ */ new Map;
var emptyContext = {
  "~effect/Context": {},
  base: emptyMap,
  depth: 0,
  mapUnsafe: emptyMap,
  pipe() {
    return pipeArguments(this, arguments);
  }
};

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/Formatter.js
function format(input, options) {
  const space = options?.space ?? 0;
  const ancestors = new WeakSet;
  const gap = !space ? "" : typeof space === "number" ? " ".repeat(space) : space;
  const ind = (d) => gap.repeat(d);
  const wrap = (v, body) => {
    const ctor = v?.constructor;
    return ctor && ctor !== Object.prototype.constructor && ctor.name ? `${ctor.name}(${body})` : body;
  };
  const ownKeys = (o) => {
    try {
      return Reflect.ownKeys(o);
    } catch {
      return ["[ownKeys threw]"];
    }
  };
  function recur(v, d = 0) {
    try {
      return recurUnsafe(v, d);
    } catch {
      if (typeof v === "object" && v !== null || typeof v === "function")
        ancestors.delete(v);
      return "[inspection threw]";
    }
  }
  function recurUnsafe(v, d = 0) {
    if (typeof v === "string")
      return JSON.stringify(v);
    if (typeof v === "number" || v == null || typeof v === "boolean" || typeof v === "symbol")
      return String(v);
    if (typeof v === "bigint")
      return String(v) + "n";
    if (typeof v === "object" || typeof v === "function") {
      if (ancestors.has(v))
        return CIRCULAR;
      ancestors.add(v);
      let output;
      if (symbolRedactable in v) {
        output = recur(getRedacted(v), d);
      } else if (Array.isArray(v)) {
        output = !gap || v.length <= 1 ? `[${v.map((x) => recur(x, d)).join(",")}]` : `[
${ind(d + 1)}${v.map((x) => recur(x, d + 1)).join(`,
` + ind(d + 1))}
${ind(d)}]`;
      } else if (v instanceof Date) {
        output = formatDate(v);
      } else if (!options?.ignoreToString && hasProperty(v, "toString") && typeof v["toString"] === "function" && v["toString"] !== Object.prototype.toString && v["toString"] !== Array.prototype.toString) {
        const s = safeToString(v);
        output = v instanceof Error && v.cause !== undefined ? `${s} (cause: ${recur(v.cause, d)})` : s;
      } else if (Symbol.iterator in v) {
        output = `${v.constructor.name}(${recur(Array.from(v), d)})`;
      } else {
        const keys = ownKeys(v);
        if (!gap || keys.length <= 1) {
          const body = `{${keys.map((k) => `${formatPropertyKey(k)}:${recur(safeGet(v, k), d)}`).join(",")}}`;
          output = wrap(v, body);
        } else {
          const body = `{
${keys.map((k) => `${ind(d + 1)}${formatPropertyKey(k)}: ${recur(safeGet(v, k), d + 1)}`).join(`,
`)}
${ind(d)}}`;
          output = wrap(v, body);
        }
      }
      ancestors.delete(v);
      return output;
    }
    return String(v);
  }
  return recur(input, 0);
}
var CIRCULAR = "[Circular]";
function formatPropertyKey(name) {
  return typeof name === "string" ? JSON.stringify(name) : String(name);
}
function formatPath(path) {
  return path.map((key) => `[${formatPropertyKey(key)}]`).join("");
}
function formatDate(date) {
  try {
    return date.toISOString();
  } catch {
    return "Invalid Date";
  }
}
function safeToString(input) {
  try {
    const s = input.toString();
    return typeof s === "string" ? s : String(s);
  } catch {
    return "[toString threw]";
  }
}
function safeGet(input, key) {
  try {
    return input[key];
  } catch {
    return "[property access threw]";
  }
}

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/Inspectable.js
var NodeInspectSymbol = /* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom");
var toJson = (input) => {
  try {
    input = redact(input);
    if (hasProperty(input, "toJSON") && isFunction(input["toJSON"]) && input["toJSON"].length === 0) {
      return input.toJSON();
    } else if (Array.isArray(input)) {
      return input.map(toJson);
    }
    return input;
  } catch {
    return "[toJSON threw]";
  }
};
var BaseProto = {
  toJSON() {
    return toJson(this);
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  toString() {
    return format(this.toJSON());
  }
};

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/internal/stackTraceLimit.js
var isStackTraceLimitWritable = () => {
  const desc = Object.getOwnPropertyDescriptor(Error, "stackTraceLimit");
  if (desc === undefined) {
    return Object.isExtensible(Error);
  }
  return Object.hasOwn(desc, "writable") ? desc.writable === true : desc.set !== undefined;
};
var canWriteStackTraceLimit = /* @__PURE__ */ isStackTraceLimitWritable();
var getStackTraceLimit = () => Error.stackTraceLimit;
var setStackTraceLimit = (value) => {
  if (canWriteStackTraceLimit) {
    Error.stackTraceLimit = value;
  }
};

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/Utils.js
class SingleShotGen {
  constructor(self) {
    this.value = self;
    this.done = false;
  }
  next(a) {
    if (this.done) {
      this.value = a;
      return this;
    }
    this.done = true;
    return {
      value: this.value,
      done: false
    };
  }
}
var pickInternalCall = () => {
  const InternalTypeId = "~effect/Utils/internal";
  const standard = {
    [InternalTypeId]: (body) => {
      return body();
    }
  };
  const forced = {
    [InternalTypeId]: (body) => {
      try {
        return body();
      } finally {}
    }
  };
  const limit = getStackTraceLimit();
  if (limit === 0)
    return forced[InternalTypeId];
  setStackTraceLimit(2);
  const error = standard[InternalTypeId](() => new Error);
  setStackTraceLimit(limit);
  return error.stack?.includes(InternalTypeId) === true ? standard[InternalTypeId] : forced[InternalTypeId];
};
var internalCall = /* @__PURE__ */ pickInternalCall();

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/internal/record.js
function assignProperty(self, key, value) {
  if (key === "__proto__") {
    Object.defineProperty(self, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true
    });
  } else {
    self[key] = value;
  }
}
function assignProperties(self, source) {
  if (!Object.hasOwn(source, "__proto__")) {
    Object.assign(self, source);
    return;
  }
  for (const key of Reflect.ownKeys(source)) {
    if (Object.prototype.propertyIsEnumerable.call(source, key)) {
      assignProperty(self, key, source[key]);
    }
  }
}

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/internal/core.js
var EffectTypeId = `~effect/Effect`;
var ExitTypeId = `~effect/Exit`;
var effectVariance = {
  _A: identity,
  _E: identity,
  _R: identity
};
var identifier = `${EffectTypeId}/identifier`;
var args = `${EffectTypeId}/args`;
var evaluate = `${EffectTypeId}/evaluate`;
var contA = `${EffectTypeId}/successCont`;
var contE = `${EffectTypeId}/failureCont`;
var contAll = `${EffectTypeId}/ensureCont`;
var Yield = /* @__PURE__ */ Symbol.for("effect/Effect/Yield");
var PipeInspectableProto = {
  pipe() {
    return pipeArguments(this, arguments);
  },
  toJSON() {
    return {
      ...this
    };
  },
  toString() {
    return format(this.toJSON(), {
      ignoreToString: true,
      space: 2
    });
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  }
};
var StructuralProto = {
  [symbol]() {
    return structureKeys(this, Object.keys(this));
  },
  [symbol2](that) {
    const selfKeys = Object.keys(this);
    const thatKeys = Object.keys(that);
    if (selfKeys.length !== thatKeys.length)
      return false;
    for (let i = 0;i < selfKeys.length; i++) {
      if (selfKeys[i] !== thatKeys[i] || !equals(this[selfKeys[i]], that[selfKeys[i]])) {
        return false;
      }
    }
    return true;
  }
};
var EffectProto = {
  [EffectTypeId]: effectVariance,
  ...PipeInspectableProto,
  [Symbol.iterator]() {
    return new SingleShotGen(this);
  },
  toJSON() {
    return {
      _id: "Effect",
      op: this[identifier],
      ...args in this ? {
        args: this[args]
      } : undefined
    };
  }
};
var isExit = (u) => hasProperty(u, ExitTypeId);
var CauseTypeId = "~effect/Cause";
var CauseReasonTypeId = "~effect/Cause/Reason";
var isCause = (self) => hasProperty(self, CauseTypeId);
class CauseImpl {
  constructor(failures) {
    this[CauseTypeId] = CauseTypeId;
    this.reasons = failures;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
  toJSON() {
    return {
      _id: "Cause",
      reasons: this.reasons.map((f) => f.toJSON())
    };
  }
  toString() {
    return `Cause(${format(this.reasons)})`;
  }
  [NodeInspectSymbol]() {
    return this.toJSON();
  }
  [symbol2](that) {
    return isCause(that) && this.reasons.length === that.reasons.length && this.reasons.every((e, i) => equals(e, that.reasons[i]));
  }
  [symbol]() {
    return array(this.reasons);
  }
}
var annotationsMap = /* @__PURE__ */ new WeakMap;

class ReasonBase {
  [CauseReasonTypeId];
  annotations;
  _tag;
  constructor(_tag, annotations, originalError) {
    this[CauseReasonTypeId] = CauseReasonTypeId;
    this._tag = _tag;
    if (annotations !== constEmptyAnnotations && typeof originalError === "object" && originalError !== null && annotations.size > 0) {
      const prevAnnotations = annotationsMap.get(originalError);
      if (prevAnnotations) {
        annotations = new Map([...prevAnnotations, ...annotations]);
      }
      annotationsMap.set(originalError, annotations);
    }
    this.annotations = annotations;
  }
  annotate(annotations, options) {
    if (annotations.mapUnsafe.size === 0)
      return this;
    const newAnnotations = new Map(this.annotations);
    annotations.mapUnsafe.forEach((value, key) => {
      if (options?.overwrite !== true && newAnnotations.has(key))
        return;
      newAnnotations.set(key, value);
    });
    if (options?.overwrite !== true && newAnnotations.size === this.annotations.size)
      return this;
    const self = Object.assign(Object.create(Object.getPrototypeOf(this)), this);
    self.annotations = newAnnotations;
    return self;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
  toString() {
    return format(this);
  }
  [NodeInspectSymbol]() {
    return this.toString();
  }
}
var constEmptyAnnotations = /* @__PURE__ */ new Map;

class Fail extends ReasonBase {
  constructor(error, annotations = constEmptyAnnotations) {
    super("Fail", annotations, error);
    this.error = error;
  }
  toString() {
    return `Fail(${format(this.error)})`;
  }
  toJSON() {
    return {
      _tag: "Fail",
      error: this.error
    };
  }
  [symbol2](that) {
    return isFailReason(that) && equals(this.error, that.error) && equals(this.annotations, that.annotations);
  }
  [symbol]() {
    return combine(string(this._tag))(combine(hash(this.error))(hash(this.annotations)));
  }
}
var causeFromReasons = (reasons) => new CauseImpl(reasons);
var dedupeReasons = (self, that) => {
  const buckets = new Map;
  const out = [];
  for (const reason of self.concat(that)) {
    const hash2 = hash(reason);
    const bucket = buckets.get(hash2);
    if (bucket === undefined) {
      buckets.set(hash2, [reason]);
    } else if (bucket.some((previous) => equals(previous, reason))) {
      continue;
    } else {
      bucket.push(reason);
    }
    out.push(reason);
  }
  return out;
};
var causeCombine = /* @__PURE__ */ dual(2, (self, that) => {
  if (self.reasons.length === 0) {
    return that;
  } else if (that.reasons.length === 0) {
    return self;
  }
  const newCause = new CauseImpl(dedupeReasons(self.reasons, that.reasons));
  return equals(self, newCause) ? self : newCause;
});
var causeAddInterrupts = (self, interrupts) => {
  const reasons = self.reasons.slice();
  for (const reason of interrupts.reasons) {
    if (isInterruptReason(reason) && !reasons.some((r) => isInterruptReason(r) && r.fiberId === reason.fiberId && r.annotations === reason.annotations)) {
      reasons.push(reason);
    }
  }
  return reasons.length === self.reasons.length ? self : new CauseImpl(reasons);
};
var causeFail = (error) => new CauseImpl([new Fail(error)]);

class Die extends ReasonBase {
  constructor(defect, annotations = constEmptyAnnotations) {
    super("Die", annotations, defect);
    this.defect = defect;
  }
  toString() {
    return `Die(${format(this.defect)})`;
  }
  toJSON() {
    return {
      _tag: "Die",
      defect: this.defect
    };
  }
  [symbol2](that) {
    return isDieReason(that) && equals(this.defect, that.defect) && equals(this.annotations, that.annotations);
  }
  [symbol]() {
    return combine(string(this._tag))(combine(hash(this.defect))(hash(this.annotations)));
  }
}
var causeDie = (defect) => new CauseImpl([new Die(defect)]);
var causeAnnotate = /* @__PURE__ */ dual((args) => isCause(args[0]), (self, annotations, options) => {
  if (annotations.mapUnsafe.size === 0)
    return self;
  return new CauseImpl(self.reasons.map((f) => f.annotate(annotations, options)));
});
var isFailReason = (self) => self._tag === "Fail";
var isDieReason = (self) => self._tag === "Die";
var isInterruptReason = (self) => self._tag === "Interrupt";
function defaultEvaluate(_fiber) {
  return exitDie(`Effect.evaluate: Not implemented`);
}
var makePrimitiveProto = (options) => ({
  ...EffectProto,
  [identifier]: options.op,
  [evaluate]: options[evaluate] ?? defaultEvaluate,
  [contA]: options[contA],
  [contE]: options[contE],
  [contAll]: options[contAll]
});
var makePrimitive = (options) => {
  const Proto = makePrimitiveProto(options);
  const PrimitiveImpl = function(value) {
    this[args] = value;
  };
  PrimitiveImpl.prototype = Proto;
  return function(value) {
    return new PrimitiveImpl(value);
  };
};
var makeExit = (options) => {
  const Proto = {
    [ExitTypeId]: ExitTypeId,
    _tag: options.op,
    get [options.prop]() {
      return this[args];
    },
    ...makePrimitiveProto(options),
    toString() {
      return `${options.op}(${format(this[args])})`;
    },
    toJSON() {
      return {
        _id: "Exit",
        _tag: options.op,
        [options.prop]: this[args]
      };
    },
    [symbol2](that) {
      return isExit(that) && that._tag === this._tag && equals(this[args], that[args]);
    },
    [symbol]() {
      return combine(string(options.op), hash(this[args]));
    }
  };
  const ExitPrimitive = function(value) {
    this[args] = value;
  };
  ExitPrimitive.prototype = Proto;
  return function(value) {
    return new ExitPrimitive(value);
  };
};
var exitSucceed = /* @__PURE__ */ makeExit({
  op: "Success",
  prop: "value",
  [evaluate](fiber) {
    const cont = fiber.getCont(contA);
    return cont ? cont[contA](this[args], fiber, this) : fiber.yieldWith(this);
  }
});
var StackTraceKey = {
  key: "effect/Cause/StackTrace"
};
var InterruptorStackTrace = {
  key: "effect/Cause/InterruptorStackTrace"
};
var exitFailCause = /* @__PURE__ */ makeExit({
  op: "Failure",
  prop: "cause",
  [evaluate](fiber) {
    let cause = this[args];
    let annotated = false;
    if (fiber.cache.stackFrame) {
      cause = causeAnnotate(cause, {
        mapUnsafe: new Map([[StackTraceKey.key, fiber.cache.stackFrame]])
      });
      annotated = true;
    }
    let cont = fiber.getCont(contE);
    const interruptedCause = fiber._interruptedCause;
    if (interruptedCause && fiber.interruptible) {
      let skippedHandler = false;
      while (cont && fiber.interruptible) {
        skippedHandler ||= identifier in cont;
        cont = fiber.getCont(contE);
      }
      if (skippedHandler) {
        cause = causeFromReasons(cause.reasons.filter((reason) => reason._tag !== "Fail"));
      }
      cause = causeAddInterrupts(cause, interruptedCause);
      annotated = true;
    }
    return cont ? cont[contE](cause, fiber, annotated ? undefined : this) : fiber.yieldWith(annotated ? exitFailCause(cause) : this);
  }
});
var exitFail = (e) => exitFailCause(causeFail(e));
var exitDie = (defect) => exitFailCause(causeDie(defect));
var withFiber = /* @__PURE__ */ makePrimitive({
  op: "WithFiber",
  [evaluate](fiber) {
    return this[args](fiber);
  }
});
var withFiberSucceed = /* @__PURE__ */ makePrimitive({
  op: "WithFiberSucceed",
  [evaluate](fiber) {
    const value = this[args](fiber);
    const cont = fiber.getCont(contA);
    return cont ? cont[contA](value, fiber) : fiber.yieldWith(exitSucceed(value));
  }
});
var YieldableError = /* @__PURE__ */ function() {

  class YieldableError extends globalThis.Error {
  }
  const proto = /* @__PURE__ */ makePrimitiveProto({
    op: "YieldableError",
    [evaluate]() {
      return exitFail(this);
    }
  });
  delete proto.toString;
  Object.assign(YieldableError.prototype, proto);
  return YieldableError;
}();
var Error2 = /* @__PURE__ */ function() {
  const plainArgsSymbol = /* @__PURE__ */ Symbol.for("effect/Data/Error/plainArgs");
  return class Base extends YieldableError {
    constructor(args) {
      super(args?.message, args?.cause ? {
        cause: args.cause
      } : undefined);
      if (args) {
        assignProperties(this, args);
        Object.defineProperty(this, plainArgsSymbol, {
          value: args,
          enumerable: false
        });
      }
    }
    toJSON() {
      return {
        ...this[plainArgsSymbol],
        ...this
      };
    }
  };
}();
var TaggedError = (tag) => {

  class Base extends Error2 {
    _tag = tag;
  }
  Base.prototype.name = tag;
  return Base;
};
var DoneTypeId = "~effect/Cause/Done";
var isDone = (u) => hasProperty(u, DoneTypeId);
var DoneVoid = {
  [DoneTypeId]: DoneTypeId,
  _tag: "Done",
  value: undefined
};

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/Effectable.js
var Prototype2 = (options) => makePrimitiveProto({
  op: options.label,
  [evaluate]: options.evaluate
});

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/internal/option.js
var TypeId = "~effect/Option";
var CommonProto = {
  [TypeId]: {
    _A: (_) => _
  },
  ...PipeInspectableProto,
  [Symbol.iterator]() {
    return new SingleShotGen(this);
  }
};
var SomeProto = /* @__PURE__ */ Object.defineProperty(/* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto), {
  _tag: "Some",
  _op: "Some",
  [symbol2](that) {
    return isOption(that) && isSome(that) && equals(this.value, that.value);
  },
  [symbol]() {
    return combine(hash(this._tag))(hash(this.value));
  },
  toString() {
    return `some(${format(this.value)})`;
  },
  toJSON() {
    return {
      _id: "Option",
      _tag: this._tag,
      value: toJson(this.value)
    };
  }
}), "valueOrUndefined", {
  get() {
    return this.value;
  }
});
var NoneHash = /* @__PURE__ */ hash("None");
var NoneProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto), {
  _tag: "None",
  _op: "None",
  valueOrUndefined: undefined,
  [symbol2](that) {
    return isOption(that) && isNone(that);
  },
  [symbol]() {
    return NoneHash;
  },
  toString() {
    return `none()`;
  },
  toJSON() {
    return {
      _id: "Option",
      _tag: this._tag
    };
  }
});
var isOption = (input) => hasProperty(input, TypeId);
var isNone = (fa) => fa._tag === "None";
var isSome = (fa) => fa._tag === "Some";
var none = /* @__PURE__ */ Object.create(NoneProto);
var SomeImpl = function(value) {
  this.value = value;
};
SomeImpl.prototype = SomeProto;
var some = (value) => new SomeImpl(value);

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/internal/result.js
var TypeId2 = "~effect/Result";
var CommonProto2 = {
  [TypeId2]: {
    _A: (_) => _,
    _E: (_) => _
  },
  ...PipeInspectableProto,
  [Symbol.iterator]() {
    return new SingleShotGen(this);
  }
};
var SuccessProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto2), {
  _tag: "Success",
  _op: "Success",
  [symbol2](that) {
    return isResult(that) && isSuccess(that) && equals(this.success, that.success);
  },
  [symbol]() {
    return combine(hash(this._tag))(hash(this.success));
  },
  toString() {
    return `success(${format(this.success)})`;
  },
  toJSON() {
    return {
      _id: "Result",
      _tag: this._tag,
      value: toJson(this.success)
    };
  }
});
var FailureProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto2), {
  _tag: "Failure",
  _op: "Failure",
  [symbol2](that) {
    return isResult(that) && isFailure(that) && equals(this.failure, that.failure);
  },
  [symbol]() {
    return combine(hash(this._tag))(hash(this.failure));
  },
  toString() {
    return `failure(${format(this.failure)})`;
  },
  toJSON() {
    return {
      _id: "Result",
      _tag: this._tag,
      failure: toJson(this.failure)
    };
  }
});
var isResult = (input) => hasProperty(input, TypeId2);
var isFailure = (result) => result._tag === "Failure";
var isSuccess = (result) => result._tag === "Success";
var FailureImpl = function(failure) {
  this.failure = failure;
};
FailureImpl.prototype = FailureProto;
var fail = (failure) => new FailureImpl(failure);
var SuccessImpl = function(success) {
  this.success = success;
};
SuccessImpl.prototype = SuccessProto;
var succeed = (success) => new SuccessImpl(success);

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/Order.js
function make(compare) {
  return (self, that) => self === that ? 0 : compare(self, that);
}
var Number2 = /* @__PURE__ */ make((self, that) => {
  if (globalThis.Number.isNaN(self) && globalThis.Number.isNaN(that))
    return 0;
  if (globalThis.Number.isNaN(self))
    return -1;
  if (globalThis.Number.isNaN(that))
    return 1;
  return self < that ? -1 : 1;
});
var isLessThan = (O) => dual(2, (self, that) => O(self, that) === -1);
var isGreaterThan = (O) => dual(2, (self, that) => O(self, that) === 1);
var isLessThanOrEqualTo = (O) => dual(2, (self, that) => O(self, that) !== 1);
var isGreaterThanOrEqualTo = (O) => dual(2, (self, that) => O(self, that) !== -1);

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/Option.js
var none2 = () => none;
var some2 = some;
var isNone2 = isNone;
var isSome2 = isSome;
var match = /* @__PURE__ */ dual(2, (self, {
  onNone,
  onSome
}) => isNone2(self) ? onNone() : onSome(self.value));
var liftThrowable = (f) => (...a) => {
  try {
    return some2(f(...a));
  } catch {
    return none2();
  }
};
var filter = /* @__PURE__ */ dual(2, (self, predicate) => isNone2(self) ? none2() : predicate(self.value) ? some2(self.value) : none2());

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/Context.js
var ServiceTypeId = "~effect/Context/Service";
var Service = function() {
  function KeyClass() {}
  const self = KeyClass;
  Object.setPrototypeOf(self, ServiceProto);
  const init = (key, options) => {
    self.key = key;
    if (options?.defaultValue) {
      self[ReferenceTypeId] = ReferenceTypeId;
      self.defaultValue = options.defaultValue;
    }
    if (options?.make) {
      self.make = options.make;
    }
    if (options?.fiberCached) {
      cacheKeys.add(key);
    }
    return self;
  };
  return arguments.length > 0 ? init(arguments[0], arguments[1]) : init;
};
var ServiceProto = {
  [ServiceTypeId]: ServiceTypeId,
  .../* @__PURE__ */ Prototype2({
    label: "Service",
    evaluate(fiber) {
      return exitSucceed(get(fiber.context, this));
    }
  }),
  toJSON() {
    return {
      _id: "Service",
      key: this.key
    };
  },
  of(self) {
    return self;
  },
  context(self) {
    return make2(this, self);
  },
  use(f) {
    return withFiber((fiber) => f(get(fiber.context, this)));
  },
  useSync(f) {
    return withFiber((fiber) => exitSucceed(f(get(fiber.context, this))));
  }
};
var cacheKeys = /* @__PURE__ */ new Set;
var ReferenceTypeId = "~effect/Context/Reference";
var TypeId3 = "~effect/Context";
var FlattenAfterBaseHits = 8;
var makeImpl = (cacheRoot, base, overlay, depth, maxDepth) => {
  const self = Object.create(Proto);
  self.cacheRoot = cacheRoot ?? self;
  self.base = base;
  self.overlay = overlay;
  self.depth = depth;
  self._flat = undefined;
  self.baseHits = 0;
  self.maxDepth = maxDepth;
  return self;
};
var applyOverlays = (map, overlay) => {
  if (!overlay)
    return;
  applyOverlays(map, overlay.parent);
  map.set(overlay.key, overlay.value);
};
var flatten = (self) => {
  if (self._flat)
    return self._flat;
  if (!self.overlay)
    return self._flat = self.base;
  const map = new Map(self.base);
  applyOverlays(map, self.overlay);
  return self._flat = map;
};
var notFound = /* @__PURE__ */ Symbol();
var lookup = (self, key) => {
  const impl = self;
  for (let overlay = impl.overlay;overlay; overlay = overlay.parent) {
    if (overlay.key === key)
      return overlay.value;
  }
  const value = impl.base.get(key);
  if (value === undefined && !impl.base.has(key))
    return notFound;
  if (impl.overlay && ++impl.baseHits >= impl.base.size && impl.baseHits >= FlattenAfterBaseHits) {
    impl.base = flatten(impl);
    impl.overlay = undefined;
    impl.depth = 0;
  }
  return value;
};
var makeUnsafe = (mapUnsafe, options) => {
  const maxDepth = options?.maxDepth;
  return makeImpl(undefined, mapUnsafe, undefined, 0, Number.isInteger(maxDepth) && maxDepth >= 0 ? maxDepth : 8);
};
var Proto = {
  get mapUnsafe() {
    return flatten(this);
  },
  ...PipeInspectableProto,
  [TypeId3]: {
    _Services: (_) => _
  },
  toJSON() {
    return {
      _id: "Context",
      services: Array.from(this.mapUnsafe).map(([key, value]) => ({
        key,
        value
      }))
    };
  },
  [symbol2](that) {
    if (!isContext(that))
      return false;
    const self = this.mapUnsafe;
    const other = that.mapUnsafe;
    if (self.size !== other.size)
      return false;
    for (const [key, value] of self) {
      if (!other.has(key) || !equals(value, other.get(key)))
        return false;
    }
    return true;
  },
  [symbol]() {
    return number(this.mapUnsafe.size);
  }
};
var hasSameCache = (self, that) => self.cacheRoot === that.cacheRoot;
var isContext = (u) => hasProperty(u, TypeId3);
var isReference = (u) => !!u[ReferenceTypeId];
var empty = () => emptyContext2;
var emptyContext2 = /* @__PURE__ */ makeUnsafe(/* @__PURE__ */ new Map);
var make2 = (key, service) => makeUnsafe(new Map([[key.key, service]]));
var add = /* @__PURE__ */ dual(3, (self, key, service) => addUnsafe(self, key.key, service));
var addUnsafe = (self, key, service) => {
  const impl = self;
  const cacheRoot = cacheKeys.has(key) ? undefined : impl.cacheRoot;
  if (impl.depth >= impl.maxDepth) {
    const map = new Map(impl._flat ?? impl.base);
    if (!impl._flat)
      applyOverlays(map, impl.overlay);
    map.set(key, service);
    return makeImpl(cacheRoot, map, undefined, 0, impl.maxDepth);
  }
  return makeImpl(cacheRoot, impl.base, {
    key,
    value: service,
    parent: impl.overlay
  }, impl.depth + 1, impl.maxDepth);
};
var getOrUndefinedUnsafe = (self, key) => {
  const value = lookup(self, key);
  return value === notFound ? undefined : value;
};
var getUnsafe = /* @__PURE__ */ dual(2, (self, service) => {
  const value = lookup(self, service.key);
  if (value === notFound) {
    if (isReference(service))
      return getDefaultValue(service);
    throw serviceNotFoundError(service);
  }
  return value;
});
var get = getUnsafe;
var defaultValueCacheKey = "~effect/Context/defaultValue";
var getDefaultValue = (ref) => {
  if (defaultValueCacheKey in ref) {
    return ref[defaultValueCacheKey];
  }
  return ref[defaultValueCacheKey] = ref.defaultValue();
};
var serviceNotFoundError = (service) => {
  const error = new Error(`Service not found${service.key ? `: ${String(service.key)}` : ""}`);
  if (error.stack) {
    const lines = error.stack.split(`
`);
    lines.splice(1, 3);
    error.stack = lines.join(`
`);
  }
  return error;
};
var Reference = Service;

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/internal/array.js
var isArrayNonEmpty = (self) => self.length > 0;

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/Result.js
var succeed2 = succeed;
var fail2 = fail;
var isFailure2 = isFailure;
var match2 = /* @__PURE__ */ dual(2, (self, {
  onFailure,
  onSuccess
}) => isFailure2(self) ? onFailure(self.failure) : onSuccess(self.success));

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/Array.js
var Array2 = globalThis.Array;
var append = /* @__PURE__ */ dual(2, (self, last) => [...self, last]);
var isArray = Array2.isArray;
var isArrayNonEmpty2 = isArrayNonEmpty;
var isReadonlyArrayNonEmpty = isArrayNonEmpty;
var empty2 = () => [];
var map = /* @__PURE__ */ dual(2, (self, f) => self.map(f));

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/Scheduler.js
var Scheduler = /* @__PURE__ */ Reference("effect/Scheduler", {
  fiberCached: true,
  defaultValue: () => new MixedScheduler
});
var setMicrotask = (f) => {
  let cancelled = false;
  Promise.resolve().then(() => {
    if (!cancelled)
      f();
  });
  return () => {
    cancelled = true;
  };
};
var setTimer = "setImmediate" in globalThis ? (f) => {
  const timer = globalThis.setImmediate(f);
  return () => globalThis.clearImmediate(timer);
} : (f) => {
  const timer = setTimeout(f, 0);
  return () => clearTimeout(timer);
};
var setImmediate = (f) => {
  try {
    return setTimer(f);
  } catch {
    return setMicrotask(f);
  }
};

class PriorityBuckets {
  buckets = [];
  scheduleTask(task, priority) {
    const buckets = this.buckets;
    const len = buckets.length;
    let bucket;
    let index = 0;
    for (;index < len; index++) {
      if (buckets[index][0] > priority)
        break;
      bucket = buckets[index];
    }
    if (bucket && bucket[0] === priority) {
      bucket[1].push(task);
    } else if (index === len) {
      buckets.push([priority, [task]]);
    } else {
      buckets.splice(index, 0, [priority, [task]]);
    }
  }
  drain() {
    const buckets = this.buckets;
    this.buckets = [];
    return buckets;
  }
}

class MixedScheduler {
  executionMode;
  setImmediate;
  constructor(executionMode = "async", setImmediateFn) {
    this.executionMode = executionMode;
    this.setImmediate = setImmediateFn ?? (executionMode === "sync" ? setMicrotask : setImmediate);
  }
  shouldYield(fiber) {
    return fiber.currentOpCount >= fiber.cache.maxOpsBeforeYield;
  }
  makeDispatcher() {
    return new MixedSchedulerDispatcher(this.setImmediate);
  }
}

class MixedSchedulerDispatcher {
  tasks = /* @__PURE__ */ new PriorityBuckets;
  running = undefined;
  setImmediate;
  constructor(setImmediateFn = setImmediate) {
    this.setImmediate = setImmediateFn;
  }
  scheduleTask(task, priority) {
    this.tasks.scheduleTask(task, priority);
    if (this.running === undefined) {
      this.running = this.setImmediate(this.afterScheduled);
    }
  }
  afterScheduled = () => {
    this.running = undefined;
    this.runTasks();
  };
  runTasks() {
    const buckets = this.tasks.drain();
    for (let i = 0;i < buckets.length; i++) {
      const toRun = buckets[i][1];
      for (let j = 0;j < toRun.length; j++) {
        toRun[j]();
      }
    }
  }
  flush() {
    while (this.tasks.buckets.length > 0) {
      if (this.running !== undefined) {
        this.running();
        this.running = undefined;
      }
      this.runTasks();
    }
  }
}
var MaxOpsBeforeYield = /* @__PURE__ */ Reference("effect/Scheduler/MaxOpsBeforeYield", {
  fiberCached: true,
  defaultValue: () => 2048
});
var PreventSchedulerYield = /* @__PURE__ */ Reference("effect/Scheduler/PreventSchedulerYield", {
  fiberCached: true,
  defaultValue: () => false
});

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/Data.js
var TaggedError2 = TaggedError;

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/encoding/EncodingError.js
var EncodingErrorTypeId = "~effect/encoding/EncodingError";

class EncodingError extends (/* @__PURE__ */ TaggedError2("EncodingError")) {
  [EncodingErrorTypeId] = EncodingErrorTypeId;
}

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/Tracer.js
var ParentSpanKey = "effect/Tracer/ParentSpan";
var TracerKey = "effect/Tracer";

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/internal/metric.js
var FiberRuntimeMetricsKey = "effect/Metric/FiberRuntimeMetrics";

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/internal/references.js
var CurrentStackFrame = /* @__PURE__ */ Reference("effect/References/CurrentStackFrame", {
  fiberCached: true,
  defaultValue: constUndefined
});
var TracerEnabled = /* @__PURE__ */ Reference("effect/References/TracerEnabled", {
  fiberCached: true,
  defaultValue: constTrue
});
var CurrentLogLevel = /* @__PURE__ */ Reference("effect/References/CurrentLogLevel", {
  fiberCached: true,
  defaultValue: () => "Info"
});
var MinimumLogLevel = /* @__PURE__ */ Reference("effect/References/MinimumLogLevel", {
  fiberCached: true,
  defaultValue: () => "Info"
});

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/internal/effect.js
class Interrupt extends ReasonBase {
  constructor(fiberId, annotations = constEmptyAnnotations) {
    super("Interrupt", annotations, "Interrupted");
    this.fiberId = fiberId;
  }
  toString() {
    return `Interrupt(${this.fiberId})`;
  }
  toJSON() {
    return {
      _tag: "Interrupt",
      fiberId: this.fiberId
    };
  }
  [symbol2](that) {
    return isInterruptReason(that) && this.fiberId === that.fiberId && this.annotations === that.annotations;
  }
  [symbol]() {
    return string(`${this._tag}:${this.fiberId}`);
  }
}
var causeInterrupt = (fiberId) => new CauseImpl([new Interrupt(fiberId)]);
var hasFails = (self) => self.reasons.some(isFailReason);
var hasDies = (self) => self.reasons.some(isDieReason);
var causeElectDefects = (self) => hasDies(self) && hasFails(self) ? causeFromReasons(self.reasons.map((reason) => reason._tag === "Fail" && !isDone(reason.error) ? new Die(reason.error, reason.annotations) : reason)) : self;
var hasInterrupts = (self) => self.reasons.some(isInterruptReason);
var causeMap = /* @__PURE__ */ dual(2, (self, f) => {
  let hasFail = false;
  const failures = self.reasons.map((failure) => {
    if (isFailReason(failure)) {
      hasFail = true;
      return new Fail(f(failure.error), failure.annotations);
    }
    return failure;
  });
  return hasFail ? causeFromReasons(failures) : self;
});
var FiberTypeId = "~effect/Fiber";
var fiberVariance = {
  _A: identity,
  _E: identity
};
var fiberIdStore = {
  id: 0
};
var AsyncResource = /* @__PURE__ */ (() => {
  try {
    return globalThis.process?.getBuiltinModule?.("node:async_hooks")?.AsyncResource;
  } catch {
    return;
  }
})();
var captureAsyncContext = () => AsyncResource === undefined ? undefined : new AsyncResource("effect/Fiber");
var getCurrentFiber = () => globalThis[currentFiberTypeId];

class FiberImpl {
  constructor(context, interruptible = true) {
    this.setContext(context);
    this.id = ++fiberIdStore.id;
    this.currentOpCount = 0;
    this.interruptible = interruptible;
    this._stack = [];
    this._observers = undefined;
    this._exit = undefined;
    this._children = undefined;
    this._interruptedCause = undefined;
    this._yielded = undefined;
    this._running = false;
    this._deferredInterrupt = false;
    this._parent = undefined;
    this._asyncContext = undefined;
    this.cache.runtimeMetrics?.recordFiberStart(this.context);
  }
  get [FiberTypeId]() {
    return fiberVariance;
  }
  get currentDispatcher() {
    return this._dispatcher ??= this.cache.scheduler.makeDispatcher();
  }
  getRef(ref) {
    return get(this.context, ref);
  }
  addObserver(cb) {
    if (this._exit) {
      cb(this._exit);
      return constVoid;
    }
    if (this._observers === undefined) {
      this._observers = [cb];
    } else {
      this._observers.push(cb);
    }
    return () => this.removeObserver(cb);
  }
  removeObserver(cb) {
    if (this._exit || this._observers === undefined)
      return;
    const index = this._observers.indexOf(cb);
    if (index >= 0) {
      this._observers.splice(index, 1);
    }
  }
  interruptUnsafe(fiberId, annotations) {
    if (this._exit) {
      return;
    }
    let cause = causeInterrupt(fiberId);
    if (this.cache.stackFrame) {
      cause = causeAnnotate(cause, make2(StackTraceKey, this.cache.stackFrame));
    }
    if (annotations) {
      cause = causeAnnotate(cause, annotations);
    }
    this._interruptedCause = this._interruptedCause ? causeAddInterrupts(this._interruptedCause, cause) : cause;
    if (this.interruptible) {
      if (this._running) {
        this._deferredInterrupt = true;
      } else {
        this.evaluate(failCause(this._interruptedCause));
      }
    }
  }
  pollUnsafe() {
    return this._exit;
  }
  evaluate(effect) {
    if (this._exit) {
      return;
    } else if (this._asyncContext !== undefined) {
      const asyncContext = this._asyncContext;
      this._asyncContext = undefined;
      try {
        return asyncContext.runInAsyncScope(this.evaluate, this, effect);
      } finally {
        asyncContext.emitDestroy();
      }
    } else if (this._yielded !== undefined) {
      const yielded = this._yielded;
      this._yielded = undefined;
      yielded();
    }
    const exit = this.runLoop(effect);
    if (exit === Yield) {
      this._asyncContext = captureAsyncContext();
      return;
    }
    const interruptChildren = fiberMiddleware.interruptChildren && fiberMiddleware.interruptChildren(this);
    if (interruptChildren !== undefined) {
      return this.evaluate(flatMap(interruptChildren, () => exit));
    }
    this._exit = exit;
    this.cache.runtimeMetrics?.recordFiberEnd(this.context, this._exit);
    if (this._parent) {
      this._parent._children?.delete(this);
      this._parent = undefined;
    }
    if (this._observers !== undefined) {
      const observers = this._observers;
      this._observers = undefined;
      for (let i = 0;i < observers.length; i++) {
        observers[i](exit);
      }
    }
    this._stack.length = 0;
    this._children = undefined;
    this.context = empty();
  }
  runLoop(effect) {
    const prevFiber = globalThis[currentFiberTypeId];
    globalThis[currentFiberTypeId] = this;
    const prevRunning = this._running;
    this._running = true;
    let yielding = false;
    let current = effect;
    this.currentOpCount = 0;
    try {
      while (true) {
        try {
          if (this._deferredInterrupt) {
            this._deferredInterrupt = false;
            current = failCause(this._interruptedCause);
          }
          this.currentOpCount++;
          const cache = this.cache;
          if (!yielding && !cache.preventYield && cache.scheduler.shouldYield(this)) {
            yielding = true;
            const prev = current;
            current = flatMap(yieldNow, () => prev);
          }
          current = cache.tracerContext ? cache.tracerContext(current, this) : current[evaluate](this);
          if (current === Yield) {
            const yielded = this._yielded;
            if (ExitTypeId in yielded) {
              this._deferredInterrupt = false;
              this._yielded = undefined;
              return yielded;
            } else if (this._deferredInterrupt) {
              this._yielded = undefined;
              yielded();
              continue;
            }
            return Yield;
          }
        } catch (error) {
          if (!hasProperty(current, evaluate)) {
            return exitDie(`Fiber.runLoop: Not a valid effect: ${String(current)}`);
          }
          current = exitDie(error);
        }
      }
    } finally {
      this._running = prevRunning;
      globalThis[currentFiberTypeId] = prevFiber;
    }
  }
  getCont(symbol) {
    if (this._deferredInterrupt) {
      this._deferredInterrupt = false;
      return deferredInterruptCont;
    }
    while (true) {
      const op = this._stack.pop();
      if (!op)
        return;
      const all = op[contAll];
      if (all !== undefined) {
        const cont = all.call(op, this);
        if (cont) {
          cont[symbol] = cont;
          return cont;
        }
      }
      if (op[symbol])
        return op;
    }
  }
  succeedWith(value) {
    if ((++this.currentOpCount & maxInlineSteps - 1) === 0) {
      return exitSucceed(value);
    }
    const cont = this.getCont(contA);
    return cont ? cont[contA](value, this) : this.yieldWith(exitSucceed(value));
  }
  yieldWith(value) {
    this._yielded = value;
    return Yield;
  }
  children() {
    return this._children ??= new Set;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
  setContext(context) {
    const previous = this.context;
    this.context = context;
    if (previous !== undefined && hasSameCache(previous, context))
      return;
    const root = context.cacheRoot;
    const cache = root._fiberCache ??= makeFiberContextCache(context);
    if (this.cache?.scheduler !== cache.scheduler) {
      this._dispatcher = undefined;
    }
    this.cache = cache;
  }
  get currentSpanLocal() {
    const span = this.cache.span;
    return span?._tag === "Span" ? span : undefined;
  }
}
var makeFiberContextCache = (context) => {
  const currentTracer = getOrUndefinedUnsafe(context, TracerKey);
  return {
    scheduler: get(context, Scheduler),
    tracer: currentTracer,
    tracerContext: currentTracer ? currentTracer["context"] : undefined,
    tracerEnabled: get(context, TracerEnabled),
    span: getOrUndefinedUnsafe(context, ParentSpanKey),
    logLevel: get(context, CurrentLogLevel),
    minimumLogLevel: get(context, MinimumLogLevel),
    stackFrame: get(context, CurrentStackFrame),
    runtimeMetrics: getOrUndefinedUnsafe(context, FiberRuntimeMetricsKey),
    maxOpsBeforeYield: get(context, MaxOpsBeforeYield),
    preventYield: get(context, PreventSchedulerYield)
  };
};
var deferredInterruptCont = {
  [contA](_value, fiber) {
    return failCause(fiber._interruptedCause);
  },
  [contE](_cause, fiber) {
    return failCause(fiber._interruptedCause);
  }
};
var maxInlineSteps = 32;
var fiberMiddleware = {
  interruptChildren: undefined
};
var fiberStackAnnotations = (fiber) => {
  if (!fiber.cache.stackFrame)
    return;
  const annotations = new Map;
  annotations.set(InterruptorStackTrace.key, fiber.cache.stackFrame);
  return makeUnsafe(annotations);
};
var fiberAwaitAll = (self) => callback((resume) => {
  const iter = self[Symbol.iterator]();
  const exits = [];
  let cancel = undefined;
  function loop() {
    let result = iter.next();
    while (!result.done) {
      if (result.value._exit) {
        exits.push(result.value._exit);
        result = iter.next();
        continue;
      }
      cancel = result.value.addObserver((exit) => {
        exits.push(exit);
        loop();
      });
      return;
    }
    resume(succeed3(exits));
  }
  loop();
  return sync(() => cancel?.());
});
var fiberInterruptAll = (fibers) => withFiber((parent) => {
  const annotations = fiberStackAnnotations(parent);
  let fiberArr = empty2();
  for (const fiber of fibers) {
    fiber.interruptUnsafe(parent.id, annotations);
    fiberArr.push(fiber);
  }
  return asVoid(fiberAwaitAll(fiberArr));
});
var succeed3 = exitSucceed;
var failCause = exitFailCause;
var fail3 = exitFail;
var sync = /* @__PURE__ */ makePrimitive({
  op: "Sync",
  [evaluate](fiber) {
    const thunk = this[args];
    const value = thunk();
    const cont = fiber.getCont(contA);
    return cont ? cont[contA](value, fiber) : fiber.yieldWith(exitSucceed(value));
  }
});
var suspend = /* @__PURE__ */ makePrimitive({
  op: "Suspend",
  [evaluate](_fiber) {
    const thunk = this[args];
    return thunk();
  }
});
var fromResult = /* @__PURE__ */ match2({
  onFailure: fail3,
  onSuccess: succeed3
});
var yieldNowWith = /* @__PURE__ */ makePrimitive({
  op: "Yield",
  [evaluate](fiber) {
    let resumed = false;
    fiber.currentDispatcher.scheduleTask(() => {
      if (resumed)
        return;
      fiber.evaluate(exitVoid);
    }, this[args] ?? 0);
    return fiber.yieldWith(() => {
      resumed = true;
    });
  }
});
var yieldNow = /* @__PURE__ */ yieldNowWith(0);
var failCauseSync = (evaluate) => suspend(() => failCause(evaluate()));
var die = (defect) => exitDie(defect);
var void_ = /* @__PURE__ */ succeed3(undefined);
var try_ = (options) => {
  const evaluate = typeof options === "function" ? options : options.try;
  const catcher = typeof options === "function" ? (cause) => new UnknownError(cause, "An error occurred in Effect.try") : options.catch;
  return suspend(() => {
    try {
      return succeed3(evaluate());
    } catch (err) {
      return fail3(catcher(err));
    }
  });
};
var tryPromise = (options) => {
  const f = typeof options === "function" ? options : options.try;
  const catcher = typeof options === "function" ? (cause) => new UnknownError(cause, "An error occurred in Effect.tryPromise") : options.catch;
  return callbackOptions(function(resume, signal) {
    const failWithCatch = (cause) => suspend(() => {
      try {
        return fail3(internalCall(() => catcher(cause)));
      } catch (err) {
        return die(err);
      }
    });
    try {
      f(signal).then((a) => resume(succeed3(a)), (e) => resume(failWithCatch(e)));
    } catch (err) {
      resume(failWithCatch(err));
    }
  }, f.length !== 0);
};
var callbackOptions = /* @__PURE__ */ function() {
  const Proto = /* @__PURE__ */ makePrimitiveProto({
    op: "Async",
    [evaluate](fiber) {
      let resumed = false;
      let yielded = false;
      const controller = this.withSignal ? new AbortController : undefined;
      const onCancel = this.register.call(fiber.cache.scheduler, (effect) => {
        if (resumed)
          return;
        resumed = true;
        if (yielded) {
          fiber.evaluate(effect);
        } else {
          yielded = effect;
        }
      }, controller?.signal);
      if (yielded !== false)
        return yielded;
      yielded = true;
      fiber.yieldWith(() => {
        resumed = true;
      });
      if (controller === undefined && onCancel === undefined) {
        return Yield;
      }
      fiber._stack.push(asyncFinalizer(() => {
        resumed = true;
        controller?.abort();
        return onCancel ?? exitVoid;
      }));
      return Yield;
    }
  });
  const AsyncImpl = function(register, withSignal) {
    this.register = register;
    this.withSignal = withSignal;
  };
  AsyncImpl.prototype = Proto;
  return function(register, withSignal) {
    return new AsyncImpl(register, withSignal);
  };
}();
var asyncFinalizer = /* @__PURE__ */ makePrimitive({
  op: "AsyncFinalizer",
  [contAll](fiber) {
    if (fiber.interruptible) {
      fiber.interruptible = false;
      fiber._stack.push(setInterruptibleTrue);
    }
  },
  [contE](cause, _fiber) {
    return hasInterrupts(cause) ? flatMap(combineFinalizerCause(exitFailCause(cause), this[args]()), () => failCause(cause)) : failCause(cause);
  }
});
var callback = (register) => callbackOptions(register, register.length >= 2);
var fnBody = (bodyOrOptions, pipeables) => typeof bodyOrOptions === "function" ? bodyOrOptions : pipeables.shift().bind(bodyOrOptions.self);
var defineFunctionLength = (length, fn) => Object.defineProperty(fn, "length", {
  value: length,
  configurable: true
});
var fnUntracedEager = (bodyOrOptions, ...pipeables) => {
  const body = fnBody(bodyOrOptions, pipeables);
  return defineFunctionLength(body.length, pipeables.length === 0 ? function() {
    return fromIteratorEagerUnsafe(() => body.apply(this, arguments));
  } : function() {
    let effect = fromIteratorEagerUnsafe(() => body.apply(this, arguments));
    for (const pipeable of pipeables) {
      effect = pipeable(effect, ...arguments);
    }
    return effect;
  });
};
var fromIteratorEagerUnsafe = (evaluate) => {
  try {
    const iterator = evaluate();
    let value = undefined;
    while (true) {
      const state = iterator.next(value);
      if (state.done) {
        return succeed3(state.value);
      }
      const primitive = state.value;
      if (primitive && primitive._tag === "Success") {
        value = primitive.value;
        continue;
      } else if (primitive && primitive._tag === "Failure") {
        return state.value;
      } else {
        let isFirstExecution = true;
        return suspend(() => {
          if (isFirstExecution) {
            isFirstExecution = false;
            return flatMap(state.value, (value) => fromIteratorUnsafe(iterator, value));
          } else {
            return suspend(() => fromIteratorUnsafe(evaluate()));
          }
        });
      }
    }
  } catch (error) {
    return die(error);
  }
};
var fromIteratorUnsafe = /* @__PURE__ */ function() {
  const Proto = /* @__PURE__ */ makePrimitiveProto({
    op: "Iterator",
    [contA](value, fiber) {
      const iter = this.iterator;
      while (true) {
        const state = iter.next(value);
        if (state.done)
          return succeed3(state.value);
        if (!effectIsExit(state.value)) {
          fiber._stack.push(this);
          return state.value;
        } else if (state.value._tag === "Failure") {
          return state.value;
        }
        value = state.value.value;
      }
    },
    [evaluate](fiber) {
      return this[contA](this.initial, fiber);
    }
  });
  const IteratorImpl = function(iterator, initial) {
    this.iterator = iterator;
    this.initial = initial;
  };
  IteratorImpl.prototype = Proto;
  return function(iterator, initial) {
    return new IteratorImpl(iterator, initial);
  };
}();
var evaluateCont = function(fiber) {
  fiber._stack.push(this);
  return this[args];
};
var OnSuccessProto = /* @__PURE__ */ makePrimitiveProto({
  op: "OnSuccess",
  [evaluate]: evaluateCont
});
var ContImpl = function(self, cont, payload) {
  this[args] = self;
  this[contA] = cont;
  this.payload = payload;
};
ContImpl.prototype = OnSuccessProto;
var returnPayload = function() {
  return this.payload;
};
var continuationMarksStack = /* @__PURE__ */ (() => {
  const limit = /* @__PURE__ */ getStackTraceLimit();
  if (limit === 0)
    return false;
  const marker = "~effect/Effect/stackProbe";
  const probe = {
    [marker]: function stackProbe() {
      return new Error;
    }
  };
  setStackTraceLimit(1);
  const error = /* @__PURE__ */ probe[marker]();
  setStackTraceLimit(limit);
  return error.stack?.includes("[as " + marker + "]") === true;
})();
var mapCont = function(value, fiber) {
  const f = this.payload;
  return fiber.succeedWith(continuationMarksStack ? f(value) : internalCall(() => f(value)));
};
var andThenCont = function(value) {
  const f = this.payload;
  return f(value);
};
var asVoid = (self) => new ContImpl(self, returnPayload, exitVoid);
var flatMap = /* @__PURE__ */ dual(2, (self, f) => new ContImpl(self, andThenCont, f));
var effectIsExit = (effect) => effect[ExitTypeId] !== undefined;
var flatMapEager = /* @__PURE__ */ dual(2, (self, f) => {
  if (effectIsExit(self)) {
    return self._tag === "Success" ? f(self.value) : self;
  }
  return flatMap(self, f);
});
var map2 = /* @__PURE__ */ dual(2, (self, f) => new ContImpl(self, mapCont, f));
var mapEager = /* @__PURE__ */ dual(2, (self, f) => effectIsExit(self) ? exitMap(self, f) : map2(self, f));
var mapErrorEager = /* @__PURE__ */ dual(2, (self, f) => effectIsExit(self) ? exitMapError(self, f) : mapError(self, f));
var mapBothEager = /* @__PURE__ */ dual(2, (self, options) => effectIsExit(self) ? exitMapBoth(self, options) : mapBoth(self, options));
var exitIsSuccess = (self) => self._tag === "Success";
var exitVoid = /* @__PURE__ */ exitSucceed(undefined);
var exitMap = /* @__PURE__ */ dual(2, (self, f) => self._tag === "Success" ? exitSucceed(f(self.value)) : self);
var exitMapError = /* @__PURE__ */ dual(2, (self, f) => {
  if (self._tag === "Success")
    return self;
  return exitFailCause(causeMap(self.cause, f));
});
var exitMapBoth = /* @__PURE__ */ dual(2, (self, options) => {
  if (self._tag === "Success")
    return exitSucceed(options.onSuccess(self.value));
  return exitFailCause(causeMap(self.cause, options.onFailure));
});
var catchCause = /* @__PURE__ */ dual(2, (self, f) => new OnFailureImpl(self, f.length !== 1 ? (cause) => f(cause) : f));
var OnFailureProto = /* @__PURE__ */ makePrimitiveProto({
  op: "OnFailure",
  [evaluate]: evaluateCont
});
var OnFailureImpl = function(self, f) {
  this[args] = self;
  this[contE] = f;
};
OnFailureImpl.prototype = OnFailureProto;
var mapError = /* @__PURE__ */ dual(2, (self, f) => catchCause(self, (cause) => failCause(causeMap(cause, f))));
var mapBoth = /* @__PURE__ */ dual(2, (self, options) => matchCauseEffect(self, {
  onFailure: (cause) => failCause(causeMap(cause, options.onFailure)),
  onSuccess: (a) => sync(() => options.onSuccess(a))
}));
var matchCauseEffect = /* @__PURE__ */ dual(2, (self, options) => new OnSuccessAndFailureImpl(self, options.onSuccess.length !== 1 ? (a) => options.onSuccess(a) : options.onSuccess, options.onFailure.length !== 1 ? (cause) => options.onFailure(cause) : options.onFailure));
var OnSuccessAndFailureProto = /* @__PURE__ */ makePrimitiveProto({
  op: "OnSuccessAndFailure",
  [evaluate]: evaluateCont
});
var OnSuccessAndFailureImpl = function(self, onSuccess, onFailure) {
  this[args] = self;
  this[contA] = onSuccess;
  this[contE] = onFailure;
};
OnSuccessAndFailureImpl.prototype = OnSuccessAndFailureProto;
var exit = (self) => effectIsExit(self) ? exitSucceed(self) : exitPrimitive(self);
var exitPrimitive = /* @__PURE__ */ makePrimitive({
  op: "Exit",
  [evaluate](fiber) {
    fiber._stack.push(this);
    return this[args];
  },
  [contA](value, fiber, exit) {
    return fiber.succeedWith(exit ?? exitSucceed(value));
  },
  [contE](cause, fiber, exit) {
    return fiber.succeedWith(exit ?? exitFailCause(cause));
  }
});
var combineFinalizerCause = (exit_, finalizer) => exitIsSuccess(exit_) ? finalizer : catchCause(finalizer, (cause) => failCause(causeElectDefects(causeCombine(exit_.cause, cause))));
var uninterruptible = (self) => withFiber((fiber) => {
  if (!fiber.interruptible)
    return self;
  fiber.interruptible = false;
  fiber._stack.push(setInterruptibleTrue);
  return self;
});
var setInterruptible = /* @__PURE__ */ makePrimitive({
  op: "SetInterruptible",
  [contAll](fiber) {
    fiber.interruptible = this[args];
    if (fiber._interruptedCause && fiber.interruptible) {
      return () => failCause(fiber._interruptedCause);
    }
  }
});
var setInterruptibleTrue = /* @__PURE__ */ setInterruptible(true);
var whileLoop = /* @__PURE__ */ makePrimitive({
  op: "While",
  [contA](value, fiber) {
    this[args].step(value);
    if (this[args].while()) {
      fiber._stack.push(this);
      return this[args].body();
    }
    return exitVoid;
  },
  [evaluate](fiber) {
    if (this[args].while()) {
      fiber._stack.push(this);
      return this[args].body();
    }
    return exitVoid;
  }
});
var resolveConcurrency = (concurrency) => concurrency === "unbounded" ? Number.POSITIVE_INFINITY : Math.max(1, concurrency ?? 1);
var iterateEager = () => (options) => {
  const onItem = options.onItem;
  const step = options.step;
  const resumeSequential = (state, items, index, end, effect) => flatMap(exit(effect), (itemExit) => step(state, items[index], itemExit, index) ?? runSequential(state, items, index + 1, end) ?? void_);
  const runSequential = (state, items, index = 0, end = items.length) => {
    for (;index < end; index++) {
      const item = items[index];
      const effect = onItem(state, item, index);
      if (!effectIsExit(effect)) {
        return resumeSequential(state, items, index, end, effect);
      }
      const terminal = step(state, item, effect, index);
      if (terminal)
        return terminal._tag === "Failure" ? terminal : undefined;
    }
  };
  return runSequential;
};
var iterateConcurrentImpl = (options) => {
  const onItem = options.onItem;
  const step = options.step;
  return (state, items, opts) => {
    let index = 0;
    const end = opts.end ?? items.length;
    const concurrency = opts.concurrency;
    let done = false;
    let parentFiber;
    let fibers;
    let resume;
    let terminal;
    let effect;
    const failDefect = (error) => {
      const defect = exitDie(error);
      terminal = defect;
      done = true;
      return fibers && fibers.size > 0 ? flatMap(uninterruptible(fiberInterruptAll(Array.from(fibers))), () => terminal ?? defect) : defect;
    };
    const go = () => {
      let paused = false;
      for (;!terminal && index < end; index++) {
        const item = items[index];
        const eff = effect ?? onItem(state, item, index);
        if (effectIsExit(eff)) {
          terminal = step(state, item, eff, index);
          if (terminal)
            break;
        } else if (!parentFiber) {
          return callback((cb) => {
            parentFiber = getCurrentFiber();
            fibers = new Set;
            effect = eff;
            resume = cb;
            let result;
            try {
              result = go();
            } catch (error) {
              return cb(failDefect(error));
            }
            if (result)
              return cb(result);
            return suspend(() => {
              terminal ??= exitVoid;
              return flatMap(fibers ? fiberInterruptAll(fibers) : void_, () => terminal?._tag === "Failure" ? terminal : void_);
            });
          });
        } else {
          effect = undefined;
          const fiber = forkUnsafe(parentFiber, eff, true, true, "inherit");
          if (fiber._exit) {
            terminal = step(state, item, fiber._exit, index);
            if (terminal)
              break;
            continue;
          }
          fibers.add(fiber);
          const currentIndex = index;
          fiber.addObserver((exit) => {
            fibers.delete(fiber);
            try {
              if (terminal) {
                if (exit._tag === "Failure") {
                  const reasons = exit.cause.reasons.filter((reason) => reason._tag !== "Interrupt");
                  if (reasons.length > 0) {
                    const cause = causeFromReasons(reasons);
                    terminal = exitFailCause(terminal._tag === "Failure" ? causeElectDefects(causeCombine(terminal.cause, cause)) : cause);
                  }
                }
              } else {
                const result = step(state, item, exit, currentIndex);
                if (result) {
                  terminal = result;
                  go();
                }
              }
              if (paused) {
                const eff = go();
                if (eff)
                  resume(eff);
              } else if (done && fibers.size === 0) {
                resume(terminal ?? void_);
              }
            } catch (error) {
              resume(failDefect(error));
            }
          });
          if (fibers.size < concurrency)
            continue;
          paused = true;
          index++;
          return;
        }
      }
      done = true;
      if (terminal) {
        if (fibers && fibers.size > 0) {
          const annotations = fiberStackAnnotations(parentFiber);
          fibers.forEach((f) => f.interruptUnsafe(parentFiber.id, annotations));
          return;
        }
        if (resume || terminal._tag === "Failure") {
          return terminal;
        }
      } else if (resume) {
        if (!fibers) {
          return exitVoid;
        } else if (fibers.size === 0) {
          resume(void_);
        }
      }
    };
    return go();
  };
};
var iterateConcurrent = () => (options) => iterateConcurrentImpl(options);
var forkUnsafe = (parent, effect, immediate = false, daemon = false, uninterruptible = false) => {
  const parentRuntime = parent;
  const interruptible = uninterruptible === "inherit" ? parentRuntime.interruptible : !uninterruptible;
  const child = new FiberImpl(parentRuntime.context, interruptible);
  if (!daemon) {
    parentRuntime.children().add(child);
    child._parent = parentRuntime;
  }
  if (immediate) {
    child.evaluate(effect);
  } else {
    child._asyncContext = captureAsyncContext();
    parentRuntime.currentDispatcher.scheduleTask(() => child.evaluate(effect), 0);
  }
  return child;
};
var runForkWith = (context) => (effect, options) => {
  const fiber = new FiberImpl(options?.scheduler ? add(context, Scheduler, options.scheduler) : context, options?.uninterruptible !== true);
  fiber.evaluate(effect);
  if (fiber._exit)
    return fiber;
  if (options?.signal) {
    if (options.signal.aborted) {
      fiber.interruptUnsafe();
    } else {
      const abort = () => fiber.interruptUnsafe();
      options.signal.addEventListener("abort", abort, {
        once: true
      });
      fiber.addObserver(() => options.signal.removeEventListener("abort", abort));
    }
  }
  if (options?.onFiberStart) {
    options.onFiberStart(fiber);
  }
  return fiber;
};
var runSyncExitWith = (context) => {
  const runFork = runForkWith(context);
  return (effect) => {
    if (effectIsExit(effect))
      return effect;
    const scheduler = new MixedScheduler("sync");
    const fiber = runFork(effect, {
      scheduler
    });
    fiber._dispatcher?.flush();
    return fiber._exit ?? exitDie(new AsyncFiberError(fiber));
  };
};
var runSyncExit = /* @__PURE__ */ runSyncExitWith(/* @__PURE__ */ empty());
var MAX_TIMER_MILLIS = 2 ** 31 - 1;
var IllegalArgumentErrorTypeId = "~effect/Cause/IllegalArgumentError";
class IllegalArgumentError extends (/* @__PURE__ */ TaggedError("IllegalArgumentError")) {
  [IllegalArgumentErrorTypeId] = IllegalArgumentErrorTypeId;
  constructor(message) {
    super({
      message
    });
  }
}
var AsyncFiberErrorTypeId = "~effect/Cause/AsyncFiberError";
class AsyncFiberError extends (/* @__PURE__ */ TaggedError("AsyncFiberError")) {
  [AsyncFiberErrorTypeId] = AsyncFiberErrorTypeId;
  constructor(fiber) {
    super({
      message: "An asynchronous Effect was executed with Effect.runSync",
      fiber
    });
  }
}
var UnknownErrorTypeId = "~effect/Cause/UnknownError";
class UnknownError extends (/* @__PURE__ */ TaggedError("UnknownError")) {
  [UnknownErrorTypeId] = UnknownErrorTypeId;
  constructor(cause, message) {
    super({
      message,
      cause
    });
  }
}
var LoggerTypeId = "~effect/Logger";
var LoggerProto = {
  [LoggerTypeId]: {
    _Message: identity,
    _Output: identity
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var colors = {
  bold: "1",
  red: "31",
  green: "32",
  yellow: "33",
  blue: "34",
  cyan: "36",
  white: "37",
  gray: "90",
  black: "30",
  bgBrightRed: "101"
};
var logLevelColors = {
  None: [],
  All: [],
  Trace: [colors.gray],
  Debug: [colors.blue],
  Info: [colors.green],
  Warn: [colors.yellow],
  Error: [colors.red],
  Fatal: [colors.bgBrightRed, colors.black]
};

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/Cause.js
var isFailReason2 = isFailReason;
var die2 = causeDie;
var map3 = causeMap;
var IllegalArgumentError2 = IllegalArgumentError;

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/Exit.js
var succeed4 = exitSucceed;
var failCause2 = exitFailCause;
var fail4 = exitFail;
var void_2 = exitVoid;
var isSuccess3 = exitIsSuccess;

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/internal/dateTime.js
var TypeId4 = "~effect/DateTime";
var TimeZoneTypeId = "~effect/DateTime/TimeZone";
var Proto2 = {
  [TypeId4]: TypeId4,
  pipe() {
    return pipeArguments(this, arguments);
  },
  [NodeInspectSymbol]() {
    return this.toString();
  },
  toJSON() {
    return toDateUtc(this).toJSON();
  }
};
var ProtoUtc = {
  ...Proto2,
  _tag: "Utc",
  [symbol]() {
    return number(this.epochMilliseconds);
  },
  [symbol2](that) {
    return isDateTime(that) && that._tag === "Utc" && this.epochMilliseconds === that.epochMilliseconds;
  },
  toString() {
    return `DateTime.Utc(${toDateUtc(this).toJSON()})`;
  }
};
var ProtoZoned = {
  ...Proto2,
  _tag: "Zoned",
  [symbol]() {
    return combine(number(this.epochMilliseconds))(hash(this.zone));
  },
  [symbol2](that) {
    return isDateTime(that) && that._tag === "Zoned" && this.epochMilliseconds === that.epochMilliseconds && equals(this.zone, that.zone);
  },
  toString() {
    return `DateTime.Zoned(${formatIsoZoned(this)})`;
  }
};
var ProtoTimeZone = {
  [TimeZoneTypeId]: TimeZoneTypeId,
  [NodeInspectSymbol]() {
    return this.toString();
  }
};
var ProtoTimeZoneNamed = {
  ...ProtoTimeZone,
  _tag: "Named",
  [symbol]() {
    return string(`Named:${this.id}`);
  },
  [symbol2](that) {
    return isTimeZone(that) && that._tag === "Named" && this.id === that.id;
  },
  toString() {
    return `TimeZone.Named(${this.id})`;
  },
  toJSON() {
    return {
      _id: "TimeZone",
      _tag: "Named",
      id: this.id
    };
  }
};
var ProtoTimeZoneOffset = {
  ...ProtoTimeZone,
  _tag: "Offset",
  [symbol]() {
    return string(`Offset:${this.offset}`);
  },
  [symbol2](that) {
    return isTimeZone(that) && that._tag === "Offset" && this.offset === that.offset;
  },
  toString() {
    return `TimeZone.Offset(${offsetToString(this.offset)})`;
  },
  toJSON() {
    return {
      _id: "TimeZone",
      _tag: "Offset",
      offset: this.offset
    };
  }
};
var isDateTime = (u) => hasProperty(u, TypeId4);
var isTimeZone = (u) => hasProperty(u, TimeZoneTypeId);
var isUtc = (self) => self._tag === "Utc";
var makeUtc = (epochMillis) => {
  const self = Object.create(ProtoUtc);
  self.epochMilliseconds = epochMillis;
  Object.defineProperty(self, "partsUtc", {
    value: undefined,
    enumerable: false,
    writable: true
  });
  return self;
};
var fromDateUnsafe = (date) => {
  const epochMillis = date.getTime();
  if (Number.isNaN(epochMillis)) {
    throw new IllegalArgumentError2("Invalid date");
  }
  return makeUtc(epochMillis);
};
var makeUnsafe2 = (input) => {
  if (isDateTime(input)) {
    return input;
  } else if (input instanceof Date) {
    return fromDateUnsafe(input);
  } else if (typeof input === "object") {
    if ("epochMilliseconds" in input) {
      return fromDateUnsafe(new Date(input.epochMilliseconds));
    }
    const date = new Date(0);
    setPartsDate(date, input);
    return fromDateUnsafe(date);
  } else if (typeof input === "string" && !hasZone(input)) {
    return fromDateUnsafe(new Date(input + "Z"));
  }
  return fromDateUnsafe(new Date(input));
};
var hasZone = (input) => /Z|GMT|[+-]\d{2}$|[+-]\d{2}:?\d{2}$|\]$/.test(input) || /z$|gmt$/i.test(input);
var minEpochMillis = -8640000000000000 + 12 * 60 * 60 * 1000;
var maxEpochMillis = 8640000000000000 - 14 * 60 * 60 * 1000;
var make3 = /* @__PURE__ */ liftThrowable(makeUnsafe2);
var toUtc = (self) => makeUtc(self.epochMilliseconds);
var toDateUtc = (self) => new Date(self.epochMilliseconds);
var toDate = (self) => {
  if (self._tag === "Utc") {
    return new Date(self.epochMilliseconds);
  } else if (self.zone._tag === "Offset") {
    return new Date(self.epochMilliseconds + self.zone.offset);
  } else if (self.adjustedEpochMilliseconds !== undefined) {
    return new Date(self.adjustedEpochMilliseconds);
  }
  let bc = false;
  const parts = self.zone.format.formatToParts(self.epochMilliseconds).filter((_) => {
    if (_.type === "era") {
      bc = _.value === "BC";
      return false;
    }
    return _.type !== "literal";
  });
  const year = Number(parts[2].value);
  const date = new Date(0);
  date.setUTCFullYear(bc ? 1 - year : year, Number(parts[0].value) - 1, Number(parts[1].value));
  date.setUTCHours(Number(parts[3].value), Number(parts[4].value), Number(parts[5].value), parts[6]?.type === "fractionalSecond" ? Number(parts[6].value) : (self.epochMilliseconds % 1000 + 1000) % 1000);
  self.adjustedEpochMilliseconds = date.getTime();
  return date;
};
var zonedOffset = (self) => {
  const date = toDate(self);
  return date.getTime() - toEpochMillis(self);
};
var offsetToString = (offset) => {
  const abs = Math.abs(offset);
  let hours = Math.floor(abs / (60 * 60 * 1000));
  let minutes = Math.round(abs % (60 * 60 * 1000) / (60 * 1000));
  if (minutes === 60) {
    hours += 1;
    minutes = 0;
  }
  return `${offset < 0 ? "-" : "+"}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};
var zonedOffsetIso = (self) => offsetToString(zonedOffset(self));
var toEpochMillis = (self) => self.epochMilliseconds;
var setPartsDate = (date, parts) => {
  if (parts.year !== undefined || parts.month !== undefined || parts.day !== undefined) {
    date.setUTCFullYear(parts.year ?? date.getUTCFullYear(), parts.month !== undefined ? parts.month - 1 : date.getUTCMonth(), parts.day ?? date.getUTCDate());
  }
  if (parts.weekDay !== undefined) {
    const diff = parts.weekDay - date.getUTCDay();
    date.setUTCDate(date.getUTCDate() + diff);
  }
  if (parts.hour !== undefined) {
    date.setUTCHours(parts.hour);
  }
  if (parts.minute !== undefined) {
    date.setUTCMinutes(parts.minute);
  }
  if (parts.second !== undefined) {
    date.setUTCSeconds(parts.second);
  }
  if (parts.millisecond !== undefined) {
    date.setUTCMilliseconds(parts.millisecond);
  }
};
var constDayMillis = 24 * 60 * 60 * 1000;
var formatIso = (self) => toDateUtc(self).toISOString();
var formatIsoOffset = (self) => {
  const date = toDate(self);
  return self._tag === "Utc" ? date.toISOString() : `${date.toISOString().slice(0, -1)}${zonedOffsetIso(self)}`;
};
var formatIsoZoned = (self) => self.zone._tag === "Offset" ? formatIsoOffset(self) : `${formatIsoOffset(self)}[${self.zone.id}]`;

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/Effect.js
var tryPromise2 = tryPromise;
var succeed5 = succeed3;
var suspend2 = suspend;
var fail5 = fail3;
var failCauseSync2 = failCauseSync;
var die3 = die;
var try_2 = try_;
var fromResult2 = fromResult;
var flatMap2 = flatMap;
var exit2 = exit;
var catchCause2 = catchCause;
var runSyncExit2 = runSyncExit;
var mapEager2 = mapEager;
var mapErrorEager2 = mapErrorEager;
var mapBothEager2 = mapBothEager;
var flatMapEager2 = flatMapEager;
var fnUntracedEager2 = fnUntracedEager;

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/encoding/Base64.js
var encode = (input) => encodeBytes(typeof input === "string" ? encoder.encode(input) : input);
var decode = (str) => {
  const stripped = stripCrlf(str);
  const length = stripped.length;
  if (length % 4 !== 0) {
    return fail2(new EncodingError({
      kind: "Decode",
      module: "Base64",
      input: stripped,
      message: `Length must be a multiple of 4, but is ${length}`
    }));
  }
  const index = stripped.indexOf("=");
  if (index !== -1 && (index < length - 2 || index === length - 2 && stripped[length - 1] !== "=")) {
    return fail2(new EncodingError({
      kind: "Decode",
      module: "Base64",
      input: stripped,
      message: "Found a '=' character, but it is not at the end"
    }));
  }
  try {
    const missingOctets = stripped.endsWith("==") ? 2 : stripped.endsWith("=") ? 1 : 0;
    const result = new Uint8Array(3 * (length / 4) - missingOctets);
    for (let i = 0, j = 0;i < length; i += 4, j += 3) {
      const buffer = getCode(stripped.charCodeAt(i)) << 18 | getCode(stripped.charCodeAt(i + 1)) << 12 | getCode(stripped.charCodeAt(i + 2)) << 6 | getCode(stripped.charCodeAt(i + 3));
      result[j] = buffer >> 16;
      result[j + 1] = buffer >> 8 & 255;
      result[j + 2] = buffer & 255;
    }
    return succeed2(result);
  } catch (cause) {
    return fail2(new EncodingError({
      kind: "Decode",
      module: "Base64",
      input: stripped,
      message: cause instanceof Error ? cause.message : "Invalid input"
    }));
  }
};
var encodeBytes = (bytes) => {
  const length = bytes.length;
  const toBase64 = Uint8Array.prototype.toBase64;
  if (length >= 32 && typeof toBase64 === "function")
    return toBase64.call(bytes);
  return length < 128 ? encodeShort(bytes) : encodeLong(bytes);
};
var encodeShort = (bytes) => {
  const length = bytes.length;
  let result = "";
  let i;
  for (i = 2;i < length; i += 3) {
    result += alphabet[bytes[i - 2] >> 2];
    result += alphabet[(bytes[i - 2] & 3) << 4 | bytes[i - 1] >> 4];
    result += alphabet[(bytes[i - 1] & 15) << 2 | bytes[i] >> 6];
    result += alphabet[bytes[i] & 63];
  }
  if (i === length + 1) {
    result += alphabet[bytes[i - 2] >> 2];
    result += alphabet[(bytes[i - 2] & 3) << 4];
    result += "==";
  }
  if (i === length) {
    result += alphabet[bytes[i - 2] >> 2];
    result += alphabet[(bytes[i - 2] & 3) << 4 | bytes[i - 1] >> 4];
    result += alphabet[(bytes[i - 1] & 15) << 2];
    result += "=";
  }
  return result;
};
var encodeLong = (bytes) => {
  const length = bytes.length;
  const result = new Uint8Array(Math.ceil(length / 3) * 4);
  let i;
  let j = 0;
  for (i = 2;i < length; i += 3, j += 4) {
    result[j] = alphabetCodes[bytes[i - 2] >> 2];
    result[j + 1] = alphabetCodes[(bytes[i - 2] & 3) << 4 | bytes[i - 1] >> 4];
    result[j + 2] = alphabetCodes[(bytes[i - 1] & 15) << 2 | bytes[i] >> 6];
    result[j + 3] = alphabetCodes[bytes[i] & 63];
  }
  if (i === length + 1) {
    result[j] = alphabetCodes[bytes[i - 2] >> 2];
    result[j + 1] = alphabetCodes[(bytes[i - 2] & 3) << 4];
    result[j + 2] = paddingCode;
    result[j + 3] = paddingCode;
  }
  if (i === length) {
    result[j] = alphabetCodes[bytes[i - 2] >> 2];
    result[j + 1] = alphabetCodes[(bytes[i - 2] & 3) << 4 | bytes[i - 1] >> 4];
    result[j + 2] = alphabetCodes[(bytes[i - 1] & 15) << 2];
    result[j + 3] = paddingCode;
  }
  return decoder.decode(result);
};
var encoder = /* @__PURE__ */ new TextEncoder;
var decoder = /* @__PURE__ */ new TextDecoder;
var stripCrlf = (str) => str.replace(/[\n\r]/g, "");
var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var alphabetCodes = /* @__PURE__ */ encoder.encode(alphabet);
var paddingCode = 61;
var codes = /* @__PURE__ */ new Uint8Array(123).fill(255);
for (let i = 0;i < alphabet.length; i++)
  codes[/* @__PURE__ */ alphabet.charCodeAt(i)] = i;
codes[61] = 0;
var getCode = (charCode) => {
  if (charCode >= codes.length || codes[charCode] === 255) {
    throw new TypeError(`Invalid character ${String.fromCharCode(charCode)}`);
  }
  return codes[charCode];
};

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/DateTime.js
var isDateTime2 = isDateTime;
var isUtc2 = isUtc;
var makeUnsafe3 = makeUnsafe2;
var make4 = make3;
var toUtc2 = toUtc;
var toEpochMillis2 = toEpochMillis;
var formatIso2 = formatIso;

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/internal/schema/annotations.js
function resolve(ast) {
  return ast.checks ? ast.checks[ast.checks.length - 1].annotations : ast.annotations;
}
var STRUCTURAL_ANNOTATION_KEY = "~structural";
var SENTINELS_ANNOTATION_KEY = "~sentinels";
var CONSTRUCTOR_ANNOTATION_KEY = "~constructor";
var getExpected = /* @__PURE__ */ memoize((ast) => {
  const identifier = resolve(ast)?.identifier;
  if (typeof identifier === "string")
    return identifier;
  return ast.getExpected(getExpected);
});

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/internal/schema/parser.js
var missing = /* @__PURE__ */ Symbol();
var succeed6 = succeed4;
var missingExit = /* @__PURE__ */ succeed6(missing);
var sameExit = /* @__PURE__ */ succeed6(missing);
var toOption = (value) => value === missing ? none2() : some2(value);
var fromOptionExit = (option) => option._tag === "None" ? missingExit : succeed6(option.value);

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/SchemaIssue.js
var TypeId5 = "~effect/SchemaIssue/Issue";
function isIssue(u) {
  return hasProperty(u, TypeId5) && u[TypeId5] === TypeId5;
}
function hasInput(issue) {
  return Object.hasOwn(issue, "input");
}

class IssueNodeImpl {
  [TypeId5] = TypeId5;
  constructor(input, options) {
    if (options?.reportInput === true && input !== missing) {
      this.input = input;
    }
  }
}
var Filter = class extends IssueNodeImpl {
  _tag = "Filter";
  filter;
  issue;
  constructor(filter, issue, input, options) {
    super(input, options);
    this.filter = filter;
    this.issue = issue;
  }
};
var Encoding = class extends IssueNodeImpl {
  _tag = "Encoding";
  ast;
  issue;
  constructor(ast, issue, input, options) {
    super(input, options);
    this.ast = ast;
    this.issue = issue;
  }
};
var Pointer = class extends IssueNodeImpl {
  _tag = "Pointer";
  path;
  issue;
  constructor(path, issue) {
    super();
    this.path = path;
    this.issue = issue;
  }
};
var MissingKey = class extends IssueNodeImpl {
  _tag = "MissingKey";
  annotations;
  constructor(annotations) {
    super();
    this.annotations = annotations;
  }
};
var UnexpectedKey = class extends IssueNodeImpl {
  _tag = "UnexpectedKey";
  ast;
  constructor(ast, input, options) {
    super(input, options);
    this.ast = ast;
  }
};
var Composite = class extends IssueNodeImpl {
  _tag = "Composite";
  ast;
  issues;
  constructor(ast, issues, input, options) {
    super(input, options);
    this.ast = ast;
    this.issues = issues;
  }
};
var InvalidType = class extends IssueNodeImpl {
  _tag = "InvalidType";
  ast;
  constructor(ast, input, options) {
    super(input, options);
    this.ast = ast;
  }
};
var InvalidValue = class extends IssueNodeImpl {
  _tag = "InvalidValue";
  annotations;
  constructor(annotations, input, options) {
    super(input, options);
    this.annotations = annotations;
  }
};
var Forbidden = class extends IssueNodeImpl {
  _tag = "Forbidden";
  annotations;
  constructor(annotations, input, options) {
    super(input, options);
    this.annotations = annotations;
  }
};
var AnyOf = class extends IssueNodeImpl {
  _tag = "AnyOf";
  ast;
  issues;
  constructor(ast, issues, input, options) {
    super(input, options);
    this.ast = ast;
    this.issues = issues;
  }
};
var OneOf = class extends IssueNodeImpl {
  _tag = "OneOf";
  ast;
  successes;
  constructor(ast, successes, input, options) {
    super(input, options);
    this.ast = ast;
    this.successes = successes;
  }
};
function makeFilterIssue(entry, input, options) {
  if (isIssue(entry)) {
    return entry;
  }
  if (typeof entry === "string") {
    return new InvalidValue({
      message: entry
    }, input, options);
  }
  const inner = typeof entry.issue === "string" ? new InvalidValue({
    message: entry.issue
  }, input, options) : entry.issue;
  return new Pointer(entry.path, inner);
}
function makeSingle(out, input, options) {
  if (out === undefined) {
    return;
  }
  if (typeof out === "boolean") {
    return out ? undefined : new InvalidValue(undefined, input, options);
  }
  return makeFilterIssue(out, input, options);
}
function normalizeFilterOutput(ast, out, input, options) {
  if (Array.isArray(out)) {
    if (!isReadonlyArrayNonEmpty(out)) {
      return;
    }
    return out.length === 1 ? makeFilterIssue(out[0], input, options) : new Composite(ast, map(out, (entry) => makeFilterIssue(entry, input, options)), input, options);
  }
  return makeSingle(out, input, options);
}
var defaultLeafHook = (issue) => {
  const message = findMessage(issue);
  if (message !== undefined)
    return message;
  switch (issue._tag) {
    case "InvalidType":
      return getExpectedMessage(getExpected(issue.ast), issue);
    case "InvalidValue": {
      const expected = findExpected(issue);
      if (expected !== undefined)
        return getExpectedMessage(expected, issue);
      const input = formatInput(issue);
      return input === undefined ? "Expected a valid value" : `Invalid data ${input}`;
    }
    case "MissingKey":
      return "Missing key";
    case "UnexpectedKey": {
      const input = formatInput(issue);
      return input === undefined ? "Expected no excess property" : `Unexpected key with value ${input}`;
    }
    case "Forbidden":
      return "Forbidden operation";
    case "OneOf": {
      const input = formatInput(issue);
      return input === undefined ? "Expected exactly one member to match" : `Expected exactly one member to match the input ${input}`;
    }
  }
};
var defaultCheckHook = (issue) => findMessage(issue) ?? findMessage(issue.issue);
function formatInput(issue) {
  return hasInput(issue) ? format(issue.input) : undefined;
}
function findExpected(issue) {
  const expected = issue.annotations?.expected;
  return typeof expected === "string" ? expected : undefined;
}
function getExpectedMessage(expected, issue) {
  const input = formatInput(issue);
  return input === undefined ? `Expected ${expected}` : `Expected ${expected}, got ${input}`;
}
function getFilterMessage(issue, checkHook) {
  const message = checkHook(issue);
  if (message !== undefined || issue.issue._tag !== "InvalidValue")
    return message;
  const expected = findExpected(issue.issue);
  return expected === undefined ? getExpectedMessage(formatCheck(issue.filter), issue) : getExpectedMessage(expected, issue.issue);
}
function formatCheck(check) {
  const expected = check.annotations?.expected;
  if (typeof expected === "string")
    return expected;
  switch (check._tag) {
    case "Filter":
      return "<filter>";
    case "FilterGroup":
      return check.checks.map((check) => formatCheck(check)).join(" & ");
  }
}
function makeFormatterDefault() {
  return (issue) => formatIssue(issue, "");
}
var defaultFormatter = /* @__PURE__ */ makeFormatterDefault();
function formatIssue(issue, path, messageOverride) {
  let message;
  switch (issue._tag) {
    case "Filter":
      return formatIssue(issue.issue, path, messageOverride ?? getFilterMessage(issue, defaultCheckHook));
    case "Encoding":
      return formatIssue(issue.issue, path, messageOverride);
    case "Pointer":
      return formatIssue(issue.issue, path + formatPath(issue.path), messageOverride);
    case "Composite":
    case "AnyOf": {
      if (issue._tag === "Composite" || issue.issues.length > 0) {
        return issue.issues.map((issue) => formatIssue(issue, path, messageOverride)).join(`
`);
      }
      message = messageOverride ?? findMessage(issue) ?? getExpectedMessage(getExpected(issue.ast), issue);
      break;
    }
    default:
      message = messageOverride ?? defaultLeafHook(issue);
      break;
  }
  return path ? `${message}
  at ${path}` : message;
}
function findMessage(issue) {
  if (issue._tag === "Pointer" || issue._tag === "Composite")
    return;
  if (issue._tag === "Encoding")
    return findMessage(issue.issue);
  const annotations = issue._tag === "Filter" ? issue.filter.annotations : ("annotations" in issue) ? issue.annotations : issue.ast.annotations;
  const message = annotations?.[issue._tag === "MissingKey" ? "messageMissingKey" : issue._tag === "UnexpectedKey" ? "messageUnexpectedKey" : "message"];
  if (typeof message === "string")
    return message;
}

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/internal/schema/cause.js
function getSchemaIssue(cause) {
  let issue;
  for (const reason of cause.reasons) {
    if (!isFailReason2(reason) || !isIssue(reason.error)) {
      return;
    }
    issue ??= reason.error;
  }
  return issue;
}
function getSchemaIssueOrThrow(cause, message) {
  const issue = getSchemaIssue(cause);
  if (issue === undefined) {
    throw new Error(message, {
      cause
    });
  }
  return issue;
}

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/SchemaGetter.js
var makeGetter = (fields) => Object.assign(Object.create(Prototype), fields);
function fail6(f) {
  return transformOptionalEffect((oe, options) => fail5(f(oe, options)));
}
function forbidden(message) {
  return fail6((oe, options) => {
    const annotations = {
      message: message(oe)
    };
    return isSome2(oe) ? new Forbidden(annotations, oe.value, options) : new Forbidden(annotations);
  });
}
var forbiddenEncoding = /* @__PURE__ */ forbidden(() => "Encoding is not supported");
var passthrough_ = /* @__PURE__ */ makeGetter({
  _tag: "Passthrough"
});
function passthrough() {
  return passthrough_;
}
function transform(f) {
  return makeGetter({
    _tag: "Transform",
    transform: f
  });
}
function transformEffect(f) {
  return makeGetter({
    _tag: "TransformEffect",
    transform: f
  });
}
function transformOptional(f) {
  return makeGetter({
    _tag: "TransformOptional",
    transform: f
  });
}
function transformOptionalEffect(f) {
  return makeGetter({
    _tag: "TransformOptionalEffect",
    transform: f
  });
}
function String2() {
  return transform(globalThis.String);
}
function Number3() {
  return transform(globalThis.Number);
}
function encodeBase64() {
  return transform(encode);
}
function decodeBase64() {
  return transformEffect((input, options) => mapErrorEager2(fromResult2(decode(input)), () => new InvalidValue({
    expected: "a valid Base64 string"
  }, input, options)));
}

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/SchemaTransformation.js
var TypeId6 = "~effect/SchemaTransformation/Transformation";
var Transformation = class extends Class {
  [TypeId6] = TypeId6;
  _tag = "Transformation";
  decode;
  encode;
  constructor(decode, encode) {
    super();
    this.decode = decode;
    this.encode = encode;
  }
  flip() {
    return new Transformation(this.encode, this.decode);
  }
};
function isTransformation(u) {
  return hasProperty(u, TypeId6) && u[TypeId6] === TypeId6;
}
var makeTransformation = (options) => {
  if (isTransformation(options)) {
    return options;
  }
  return new Transformation(options.decode, options.encode);
};
function transformEffect2(options) {
  return new Transformation(transformEffect(options.decode), transformEffect(options.encode));
}
function transform2(options) {
  return new Transformation(transform(options.decode), transform(options.encode));
}
var passthrough_2 = /* @__PURE__ */ new Transformation(/* @__PURE__ */ passthrough(), /* @__PURE__ */ passthrough());
function passthrough2() {
  return passthrough_2;
}
var numberFromString = /* @__PURE__ */ new Transformation(/* @__PURE__ */ Number3(), /* @__PURE__ */ String2());
var urlFromString = /* @__PURE__ */ transformEffect2({
  decode: (s, options) => URL.canParse(s) ? succeed5(new URL(s)) : fail5(new InvalidValue({
    expected: "a valid URL string"
  }, s, options)),
  encode: (url) => succeed5(url.href)
});
var uint8ArrayFromBase64String = /* @__PURE__ */ new Transformation(/* @__PURE__ */ decodeBase64(), /* @__PURE__ */ encodeBase64());

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/SchemaAST.js
function makeGuard(tag) {
  return (ast) => ast._tag === tag;
}
var isDeclaration = /* @__PURE__ */ makeGuard("Declaration");
var isNever2 = /* @__PURE__ */ makeGuard("Never");
var isLiteral = /* @__PURE__ */ makeGuard("Literal");
var isUniqueSymbol = /* @__PURE__ */ makeGuard("UniqueSymbol");
var isArrays = /* @__PURE__ */ makeGuard("Arrays");
var isObjects = /* @__PURE__ */ makeGuard("Objects");
var isSuspend = /* @__PURE__ */ makeGuard("Suspend");
var Link = class {
  to;
  transformation;
  constructor(to, transformation) {
    this.to = to;
    this.transformation = transformation;
  }
};
var defaultParseOptions = {};
var Context = class {
  isOptional;
  isMutable;
  constructorDefault;
  annotations;
  constructor(isOptional, isMutable, constructorDefault = undefined, annotations = undefined) {
    this.isOptional = isOptional;
    this.isMutable = isMutable;
    this.constructorDefault = constructorDefault;
    this.annotations = annotations;
  }
};
var TypeId7 = "~effect/Schema";

class ASTNodeImpl {
  [TypeId7] = TypeId7;
  annotations;
  checks;
  encoding;
  context;
  constructor(annotations = undefined, checks = undefined, encoding = undefined, context = undefined) {
    this.annotations = annotations;
    this.checks = checks;
    this.encoding = encoding;
    this.context = context;
  }
  toString() {
    return `<${this._tag}>`;
  }
}
var Declaration = class extends ASTNodeImpl {
  _tag = "Declaration";
  typeParameters;
  run;
  encodingChecks;
  encodingRun;
  constructor(typeParameters, run, annotations, checks, encoding, context, encodingChecks, encodingRun) {
    super(annotations, checks, encoding, context);
    this.typeParameters = typeParameters;
    this.run = run;
    this.encodingChecks = encodingChecks;
    this.encodingRun = encodingRun;
  }
  getParser() {
    let run;
    return (input, options) => {
      if (input === missing)
        return missingExit;
      run ??= this.run(this.typeParameters);
      try {
        return run(input, this, options);
      } catch (error) {
        return die3(error);
      }
    };
  }
  _rebuild(recur, checks, encodingChecks, run, encodingRun) {
    const tps = mapOrSame(this.typeParameters, recur);
    return tps === this.typeParameters && checks === this.checks && encodingChecks === this.encodingChecks && run === this.run && encodingRun === this.encodingRun ? this : new Declaration(tps, run, this.annotations, checks, undefined, this.context, encodingChecks, encodingRun);
  }
  recur(recur) {
    return this._rebuild(recur, this.checks, this.encodingChecks, this.run, this.encodingRun);
  }
  flip(recur) {
    return this._rebuild(recur, this.encodingChecks, this.checks, this.encodingRun ?? this.run, this.run);
  }
  getExpected() {
    const expected = this.annotations?.expected;
    if (typeof expected === "string")
      return expected;
    return "<Declaration>";
  }
};
var Null = class extends ASTNodeImpl {
  _tag = "Null";
  getParser() {
    return fromConst(this, null);
  }
  getExpected() {
    return "null";
  }
};
var null_ = /* @__PURE__ */ new Null;
var Undefined = class extends ASTNodeImpl {
  _tag = "Undefined";
  getParser() {
    return fromConst(this, undefined);
  }
  toCodecJson() {
    return replaceEncoding(this, [undefinedToNull]);
  }
  getExpected() {
    return "undefined";
  }
};
var undefinedToNull = /* @__PURE__ */ new Link(null_, /* @__PURE__ */ new Transformation(/* @__PURE__ */ transform(() => {
  return;
}), /* @__PURE__ */ transform(() => null)));
var undefined_2 = /* @__PURE__ */ new Undefined;
var Any = class extends ASTNodeImpl {
  _tag = "Any";
  getParser() {
    return fromRefinement(this, isUnknown);
  }
  getExpected() {
    return "any";
  }
};
var any = /* @__PURE__ */ new Any;
var Unknown = class extends ASTNodeImpl {
  _tag = "Unknown";
  getParser() {
    return fromRefinement(this, isUnknown);
  }
  getExpected() {
    return "unknown";
  }
};
var unknown = /* @__PURE__ */ new Unknown;
function formatTemplateLiteralPath(path) {
  return typeof path === "number" ? `parts[${path}]` : path;
}
function isTemplateLiteralPart(ast, path, validated) {
  if (validated.has(ast))
    return true;
  if (ast.encoding) {
    throw new Error(`TemplateLiteral parts cannot have an encoding at ${formatTemplateLiteralPath(path)}`);
  }
  let valid;
  switch (ast._tag) {
    case "String":
    case "Number":
    case "BigInt":
      valid = true;
      break;
    case "Literal":
      valid = !ast.checks;
      break;
    case "TemplateLiteral": {
      const currentPath = formatTemplateLiteralPath(path);
      valid = !ast.checks && ast.parts.every((part, index) => isTemplateLiteralPart(part, `${currentPath}.parts[${index}]`, validated));
      break;
    }
    case "Union": {
      const currentPath = formatTemplateLiteralPath(path);
      valid = !ast.checks && ast.types.every((part, index) => isTemplateLiteralPart(part, `${currentPath}.types[${index}]`, validated));
      break;
    }
    default:
      return false;
  }
  if (valid)
    validated.add(ast);
  return valid;
}
var TemplateLiteral = class extends ASTNodeImpl {
  _tag = "TemplateLiteral";
  parts;
  encodedParts;
  literals;
  suffixLengths;
  constructor(parts, annotations, checks, encoding, context) {
    super(annotations, checks, encoding, context);
    const encodedParts = [];
    const literals = [];
    const validated = new Set;
    for (let index = 0;index < parts.length; index++) {
      const part = parts[index];
      if (!isTemplateLiteralPart(part, index, validated)) {
        throw new Error(`Invalid TemplateLiteral part ${part._tag}`);
      }
      encodedParts.push(part);
      literals.push(part._tag === "Literal" ? globalThis.String(part.literal) : undefined);
    }
    const suffixLengths = new Array(encodedParts.length + 1);
    suffixLengths[encodedParts.length] = 0;
    for (let i = encodedParts.length - 1;i >= 0; i--) {
      suffixLengths[i] = suffixLengths[i + 1] + (literals[i]?.length ?? 0);
    }
    this.parts = parts;
    this.encodedParts = encodedParts;
    this.literals = literals;
    this.suffixLengths = suffixLengths;
  }
  getParser(compile) {
    const tuple = new Arrays(false, this.parts.map(partFromString), []);
    const parser = compile(decodeTo(string2, tuple, templateLiteralTransformation(this)));
    return (input, options) => {
      if (input === missing)
        return missingExit;
      const result = parser(input, options);
      if (result._tag === "Success") {
        return sameExit;
      }
      return mapBothEager2(result, {
        onSuccess: () => input,
        onFailure: (issue) => new Composite(this, [issue], input, options)
      });
    };
  }
  getExpected() {
    return "string";
  }
  matchPart(s, options) {
    return segmentTemplateLiteralParts(this, s, options) === undefined ? undefined : s;
  }
};
function templateLiteralTransformation(template) {
  return new Transformation(transformEffect((s, options) => {
    const segments = segmentTemplateLiteralParts(template, s, options);
    if (segments)
      return succeed5(segments);
    return fail5(new InvalidValue({
      expected: "a string matching template literal parts"
    }, s, options));
  }), transform((parts) => parts.join("")));
}
var Literal = class extends ASTNodeImpl {
  _tag = "Literal";
  literal;
  constructor(literal, annotations, checks, encoding, context) {
    super(annotations, checks, encoding, context);
    if (typeof literal === "number" && !globalThis.Number.isFinite(literal)) {
      throw new Error(`A numeric literal must be finite, got ${format(literal)}`);
    }
    this.literal = literal;
  }
  getParser() {
    return fromConst(this, this.literal);
  }
  matchPart(s, _options) {
    return s === globalThis.String(this.literal) ? this.literal : undefined;
  }
  toCodecJson() {
    return typeof this.literal === "bigint" ? literalToString(this) : this;
  }
  toCodecStringTree() {
    return typeof this.literal === "string" ? this : literalToString(this);
  }
  getExpected() {
    return typeof this.literal === "string" ? JSON.stringify(this.literal) : globalThis.String(this.literal);
  }
};
function literalToString(ast) {
  const literalAsString = globalThis.String(ast.literal);
  return replaceEncoding(ast, [new Link(new Literal(literalAsString), new Transformation(transform(() => ast.literal), transform(() => literalAsString)))]);
}
var String3 = class extends ASTNodeImpl {
  _tag = "String";
  getParser() {
    return fromRefinement(this, isString);
  }
  matchPart(s, options) {
    const checks = this.checks;
    return checks && !options.disableChecks && collectIssues(checks, s, undefined, this, options) ? undefined : s;
  }
  getExpected() {
    return "string";
  }
};
var string2 = /* @__PURE__ */ new String3;
var Number4 = class extends ASTNodeImpl {
  _tag = "Number";
  getParser() {
    return fromRefinement(this, isNumber);
  }
  matchKey(s, options) {
    return this._match(isStringNumberRegExp, s, options);
  }
  matchPart(s, options) {
    return this._match(isStringFiniteRegExp, s, options);
  }
  _match(regexp, s, options) {
    if (!regexp.test(s))
      return;
    const value = globalThis.Number(s);
    if (options.disableChecks || !this.checks)
      return value;
    return collectIssues(this.checks, value, undefined, this, options) ? undefined : value;
  }
  toCodecJson() {
    if (this.checks && (hasCheck(this.checks, "effect/schema/isFinite") || hasCheck(this.checks, "effect/schema/isInt"))) {
      return this;
    }
    return replaceEncoding(this, [numberToJson]);
  }
  toCodecStringTree() {
    if (this.toCodecJson() === this) {
      return replaceEncoding(this, [finiteToString]);
    }
    return replaceEncoding(this, [numberToString]);
  }
  getExpected() {
    return "number";
  }
};
function hasCheck(checks, id) {
  return checks.some((check) => check.annotations?.representation?.id === id || check._tag === "FilterGroup" && hasCheck(check.checks, id));
}
var number2 = /* @__PURE__ */ new Number4;
var Boolean2 = class extends ASTNodeImpl {
  _tag = "Boolean";
  getParser() {
    return fromRefinement(this, isBoolean);
  }
  getExpected() {
    return "boolean";
  }
};
var boolean = /* @__PURE__ */ new Boolean2;
var Arrays = class extends ASTNodeImpl {
  _tag = "Arrays";
  isMutable;
  elements;
  rest;
  encodingChecks;
  constructor(isMutable, elements, rest, annotations, checks, encoding, context, encodingChecks) {
    super(annotations, checks, encoding, context);
    this.isMutable = isMutable;
    this.elements = elements;
    this.rest = rest;
    this.encodingChecks = encodingChecks;
    let hasOptional = false;
    for (let i = 0;i < elements.length; i++) {
      if (isOptional(elements[i])) {
        hasOptional = true;
      } else if (hasOptional) {
        throw new Error("A required element cannot follow an optional element. ts(1257)");
      }
    }
    if (hasOptional && rest.length > 1) {
      throw new Error("A required element cannot follow an optional element. ts(1257)");
    }
    for (let i = 1;i < rest.length; i++) {
      if (isOptional(rest[i])) {
        throw new Error("An optional element cannot follow a rest element. ts(1266)");
      }
    }
  }
  getParser(compile, compileField = compile) {
    const ast = this;
    let elements;
    let rest;
    const elementLen = ast.elements.length;
    const tailLen = Math.max(0, ast.rest.length - 1);
    function getParser(tailThreshold, index) {
      if (index < elementLen) {
        return elements[index];
      } else if (index >= tailThreshold) {
        return rest[index - tailThreshold + 1];
      }
      return rest[0];
    }
    const finish = (state) => {
      const {
        input,
        len,
        options
      } = state;
      if (ast.rest.length === 0 && len > elementLen) {
        for (let i = elementLen;i < len; i++) {
          const unexpected = new UnexpectedKey(ast, input[i], options);
          const issue = new Pointer([i], unexpected);
          if (options.errors === "all") {
            if (state.issues)
              state.issues.push(issue);
            else
              state.issues = [issue];
          } else {
            return fail5(new Composite(ast, [issue], input, options));
          }
        }
      }
      if (state.issues) {
        return fail5(new Composite(ast, state.issues, input, options));
      }
      return succeed6(state.output);
    };
    const parse = (input, options) => {
      const len = input.length;
      const state = {
        ast,
        getParser,
        input,
        len,
        tailThreshold: Math.max(elementLen, len - tailLen),
        output: [],
        issues: undefined,
        options
      };
      const end = ast.rest.length === 0 ? elementLen : Math.max(len, elementLen + tailLen);
      const concurrency = options.concurrency === undefined ? 1 : resolveConcurrency(options.concurrency);
      const eff = concurrency === 1 ? parseArray(state, input, 0, end) : parseArrayConcurrent(state, input, {
        concurrency,
        end
      });
      if (!eff)
        return finish(state);
      if (effectIsExit(eff))
        return flatMapEager2(eff, () => finish(state));
      let first = true;
      return suspend2(() => {
        if (!first)
          return parse(input, options);
        first = false;
        return flatMap2(eff, () => finish(state));
      });
    };
    return (input, options) => {
      if (input === missing)
        return missingExit;
      try {
        if (!Array.isArray(input)) {
          return fail5(new InvalidType(ast, input, options));
        }
        if (!elements) {
          elements = ast.elements.map((ast) => ({
            ast,
            parser: compileField(ast)
          }));
          rest = ast.rest.map((ast) => ({
            ast,
            parser: compileField(ast)
          }));
        }
        return parse(input, options);
      } catch (error) {
        return die3(error);
      }
    };
  }
  _rebuild(recur, checks, encodingChecks) {
    const elements = mapOrSame(this.elements, recur);
    const rest = mapOrSame(this.rest, recur);
    return elements === this.elements && rest === this.rest && checks === this.checks && encodingChecks === this.encodingChecks ? this : new Arrays(this.isMutable, elements, rest, this.annotations, checks, undefined, this.context, encodingChecks);
  }
  recur(recur) {
    return this._rebuild(recur, this.checks, this.encodingChecks);
  }
  flip(recur) {
    return this._rebuild(recur, this.encodingChecks, this.checks);
  }
  getExpected() {
    return "array";
  }
};
function stepArray(s, item, exit, i) {
  if (exit._tag === "Failure") {
    return wrapPropertyKeyIssue(s, s.ast, i, exit);
  }
  const value = exit === sameExit ? item : exit[args];
  if (value !== missing) {
    s.output[i] = value;
  } else {
    const p = s.getParser(s.tailThreshold, i);
    if (isOptional(p.ast))
      return;
    const issue = new Pointer([i], new MissingKey(p.ast.context?.annotations));
    if (s.options.errors === "all") {
      if (s.issues)
        s.issues.push(issue);
      else
        s.issues = [issue];
    } else {
      return fail4(new Composite(s.ast, [issue], s.input, s.options));
    }
  }
}
var parseArrayOptions = {
  onItem(s, item, i) {
    const value = i < s.len ? item : missing;
    return s.getParser(s.tailThreshold, i).parser(value, s.options);
  },
  step: stepArray
};
var parseArray = /* @__PURE__ */ iterateEager()(parseArrayOptions);
var parseArrayConcurrent = /* @__PURE__ */ iterateConcurrent()(parseArrayOptions);
var wrapPropertyKeyIssue = (s, ast, key, exit) => {
  if (exit.cause.reasons.length === 0) {
    return exit;
  }
  const issue = getSchemaIssue(exit.cause);
  if (issue === undefined) {
    return failCause2(map3(exit.cause, (issue) => new Composite(ast, [new Pointer([key], issue)], s.input, s.options)));
  }
  const pointer = new Pointer([key], issue);
  if (s.options.errors === "all") {
    if (s.issues)
      s.issues.push(pointer);
    else
      s.issues = [pointer];
  } else {
    return fail4(new Composite(ast, [pointer], s.input, s.options));
  }
};
var FINITE_PATTERN = "[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:[Ee][+-]?\\d+)?";
function getIndexSignatureKeys(input, parameter, options = defaultParseOptions) {
  let stringKeys;
  let symbolKeys;
  function go(parameter) {
    switch (parameter._tag) {
      case "String":
      case "TemplateLiteral":
        return (stringKeys ??= Object.keys(input)).filter((k) => parameter.matchPart(k, options) !== undefined);
      case "Number":
        return (stringKeys ??= Object.keys(input)).filter((k) => parameter.matchKey(k, options) !== undefined);
      case "Symbol":
        return (symbolKeys ??= Object.getOwnPropertySymbols(input)).filter((k) => Object.prototype.propertyIsEnumerable.call(input, k) && parameter.matchKey(k, options) !== undefined);
      case "Union":
        return [...new Set(parameter.types.flatMap(go))];
      default:
        return [];
    }
  }
  return go(parameterFromPropertyKey(toEncoded(parameter)));
}
var PropertySignature = class {
  name;
  type;
  constructor(name, type) {
    this.name = name;
    this.type = type;
  }
};
function isIndexSignatureParameterSide(ast) {
  switch (ast._tag) {
    case "String":
    case "Number":
    case "Symbol":
    case "TemplateLiteral":
      return true;
    case "Union":
      return ast.types.every(isIndexSignatureParameterSide);
    default:
      return false;
  }
}
function isIndexSignatureParameterEncodedSide(ast) {
  const encoded = getLastEncoding(ast);
  switch (encoded._tag) {
    case "String":
    case "Number":
    case "Symbol":
    case "TemplateLiteral":
      return true;
    case "Union":
      return encoded.types.every(isIndexSignatureParameterEncodedSide);
    default:
      return false;
  }
}
function isIndexSignatureParameter(ast) {
  return isIndexSignatureParameterSide(ast) && isIndexSignatureParameterEncodedSide(ast);
}
var IndexSignature = class {
  parameter;
  type;
  constructor(parameter, type) {
    if (!isIndexSignatureParameter(parameter)) {
      throw new Error(`Invalid index signature parameter ${parameter._tag}`);
    }
    this.parameter = parameter;
    this.type = type;
    if (isOptional(type) || type.encoding !== undefined && isOptional(toEncoded(type))) {
      throw new Error("Cannot use `Schema.optionalKey` or `Schema.optional` with index signatures. Index signatures already allow keys to be absent; use `Schema.UndefinedOr` to allow `undefined` values.");
    }
  }
};
var Objects = class extends ASTNodeImpl {
  _tag = "Objects";
  propertySignatures;
  indexSignatures;
  encodingChecks;
  constructor(propertySignatures, indexSignatures, annotations, checks, encoding, context, encodingChecks) {
    super(annotations, checks, encoding, context);
    this.propertySignatures = propertySignatures;
    this.indexSignatures = indexSignatures;
    this.encodingChecks = encodingChecks;
  }
  getParser(compile, compileField = compile) {
    const ast = this;
    const hasProperties = ast.propertySignatures.length;
    const indexCount = ast.indexSignatures.length;
    if (!hasProperties && !indexCount) {
      return fromRefinement(ast, isNotNullish);
    }
    let properties;
    let indexes;
    const compileMembers = () => {
      if (!properties) {
        properties = ast.propertySignatures.map((ps) => ({
          parser: compileField(ps.type),
          name: ps.name,
          type: ps.type
        }));
        indexes = indexCount ? ast.indexSignatures.map((is) => ({
          is,
          parserKey: compile(parameterFromPropertyKey(is.parameter)),
          parserValue: compileField(is.type)
        })) : undefined;
      }
      return properties;
    };
    const makeFallback = () => {
      const expectedKeys = new Set(ast.propertySignatures.map((ps) => typeof ps.name === "number" ? globalThis.String(ps.name) : ps.name));
      const finishIndex = (s, key, k2, inputValue, exitValue) => {
        if (exitValue._tag === "Failure") {
          return wrapPropertyKeyIssue(s, ast, key, exitValue) ?? void_2;
        }
        const value = exitValue === sameExit ? inputValue : exitValue[args];
        if (k2 !== missing && value !== missing) {
          if (hasProperties && (expectedKeys.has(key) || expectedKeys.has(typeof k2 === "number" ? globalThis.String(k2) : k2)))
            return void_2;
          assignProperty(s.out, k2, value);
        }
        return void_2;
      };
      const parseIndex = (s, key, index, exitKey) => {
        if (!exitKey) {
          const eff = index.parserKey(key, s.options);
          if (!effectIsExit(eff)) {
            return flatMap2(exit2(eff), (exit) => parseIndex(s, key, index, exit));
          }
          exitKey = eff;
        }
        if (exitKey._tag === "Failure") {
          return wrapPropertyKeyIssue(s, ast, key, exitKey) ?? void_2;
        }
        const k2 = exitKey === sameExit ? key : exitKey[args];
        const inputValue = s.input[key];
        const result = index.parserValue(inputValue, s.options);
        return effectIsExit(result) ? finishIndex(s, key, k2, inputValue, result) : flatMap2(exit2(result), (exit) => finishIndex(s, key, k2, inputValue, exit));
      };
      const parseStringIndex = (s, key, index) => {
        const inputValue = s.input[key];
        const result = index.parserValue(inputValue, s.options);
        return effectIsExit(result) ? finishIndex(s, key, key, inputValue, result) : flatMap2(exit2(result), (exit) => finishIndex(s, key, key, inputValue, exit));
      };
      const parseIndexes = indexCount ? iterateConcurrent()({
        onItem: (s, [key, index]) => index.is.parameter === string2 ? parseStringIndex(s, key, index) : parseIndex(s, key, index),
        step: (_s, _item, exit) => exit._tag === "Failure" ? exit : undefined
      }) : undefined;
      return fnUntracedEager2(function* (input, options) {
        if (input === missing) {
          return missing;
        }
        if (!(typeof input === "object" && input !== null && !Array.isArray(input))) {
          return yield* fail5(new InvalidType(ast, input, options));
        }
        compileMembers();
        const record = input;
        const out = {};
        const state = {
          ast,
          input: record,
          out,
          issues: undefined,
          options
        };
        const errorsAllOption = options.errors === "all";
        const onExcessPropertyError = options.onExcessProperty === "error";
        const concurrency = options.concurrency === undefined ? 1 : resolveConcurrency(options.concurrency);
        const indexKeys = indexCount && onExcessPropertyError ? ast.indexSignatures.map((index) => getIndexSignatureKeys(record, index.parameter, options)) : undefined;
        if (onExcessPropertyError) {
          const coveredKeys = indexKeys ? new Set(expectedKeys) : expectedKeys;
          if (indexKeys) {
            for (const keys of indexKeys) {
              for (const key of keys)
                coveredKeys.add(key);
            }
          }
          const inputKeys = Reflect.ownKeys(record);
          for (let i = 0;i < inputKeys.length; i++) {
            const key = inputKeys[i];
            if (!coveredKeys.has(key) && Object.prototype.propertyIsEnumerable.call(record, key)) {
              const unexpected = new UnexpectedKey(ast, record[key], options);
              const issue = new Pointer([key], unexpected);
              if (errorsAllOption) {
                if (state.issues) {
                  state.issues.push(issue);
                } else {
                  state.issues = [issue];
                }
                continue;
              } else {
                return yield* fail5(new Composite(ast, [issue], input, options));
              }
            }
          }
        }
        if (hasProperties) {
          const eff = concurrency === 1 ? parseProperties(state, properties) : parsePropertiesConcurrent(state, properties, {
            concurrency
          });
          if (eff)
            yield* eff;
        }
        if (indexCount && concurrency === 1) {
          for (let i = 0;i < indexCount; i++) {
            const index = indexes[i];
            const parse = index.is.parameter === string2 ? parseStringIndex : parseIndex;
            const keys = indexKeys?.[i] ?? (index.is.parameter === string2 ? Object.keys(record) : getIndexSignatureKeys(record, index.is.parameter, options));
            for (let j = 0;j < keys.length; j++) {
              const eff = parse(state, keys[j], index);
              if (!effectIsExit(eff))
                yield* eff;
              else if (eff._tag === "Failure")
                return yield* eff;
            }
          }
        } else if (parseIndexes) {
          const keyPairs = empty2();
          for (let i = 0;i < indexCount; i++) {
            const index = indexes[i];
            const keys = indexKeys?.[i] ?? (index.is.parameter === string2 ? Object.keys(record) : getIndexSignatureKeys(record, index.is.parameter, options));
            for (let j = 0;j < keys.length; j++) {
              keyPairs.push([keys[j], index]);
            }
          }
          const eff = parseIndexes(state, keyPairs, {
            concurrency
          });
          if (eff)
            yield* eff;
        }
        if (state.issues) {
          return yield* fail5(new Composite(ast, state.issues, input, options));
        }
        return out;
      });
    };
    if (indexCount)
      return makeFallback();
    let fallback;
    const resume = (snapshot, index, pending) => {
      const property = properties[index];
      return flatMap2(exit2(pending), (exit) => {
        const state = {
          ...snapshot,
          out: {
            ...snapshot.out
          }
        };
        const terminal = stepProperty(state, property, exit);
        if (terminal)
          return terminal;
        const done = () => succeed6(state.out);
        const eff = parseProperties(state, properties.slice(index + 1));
        return eff ? flatMapEager2(eff, done) : done();
      });
    };
    return (input, options) => {
      if (input === missing)
        return missingExit;
      if (options.errors === "all" || options.onExcessProperty !== undefined || options.concurrency !== undefined && resolveConcurrency(options.concurrency) !== 1) {
        return (fallback ??= makeFallback())(input, options);
      }
      if (!(typeof input === "object" && input !== null && !Array.isArray(input))) {
        return fail5(new InvalidType(ast, input, options));
      }
      const props = compileMembers();
      const record = input;
      const out = {};
      const state = {
        ast,
        input: record,
        out,
        issues: undefined,
        options
      };
      try {
        for (let index = 0;index < props.length; index++) {
          const property = props[index];
          const name = property.name;
          const hasKey = hasPropertySignature(record, name);
          const value = hasKey ? record[name] : missing;
          const exit = property.parser(value, options);
          if (!effectIsExit(exit)) {
            return resume(state, index, exit);
          }
          if (exit === sameExit) {
            if (hasKey)
              assignProperty(out, name, value);
            continue;
          }
          const terminal = stepProperty(state, property, exit);
          if (terminal)
            return terminal;
        }
      } catch (error) {
        return die3(error);
      }
      return succeed6(out);
    };
  }
  _rebuild(recur, recurParameter, checks, encodingChecks) {
    const props = mapOrSame(this.propertySignatures, (ps) => {
      const t = recur(ps.type);
      return t === ps.type ? ps : new PropertySignature(ps.name, t);
    });
    const indexes = mapOrSame(this.indexSignatures, (is) => {
      const p = recurParameter(is.parameter);
      const t = recur(is.type);
      return p === is.parameter && t === is.type ? is : new IndexSignature(p, t);
    });
    return props === this.propertySignatures && indexes === this.indexSignatures && checks === this.checks && encodingChecks === this.encodingChecks ? this : new Objects(props, indexes, this.annotations, checks, undefined, this.context, encodingChecks);
  }
  flip(recur) {
    return this._rebuild(recur, recur, this.encodingChecks, this.checks);
  }
  recur(recur, recurParameter = recur) {
    return this._rebuild(recur, recurParameter, this.checks, this.encodingChecks);
  }
  getExpected() {
    if (this.propertySignatures.length === 0 && this.indexSignatures.length === 0)
      return "object | array";
    return "object";
  }
};
function stepProperty(s, p, exit) {
  if (exit._tag === "Failure") {
    return wrapPropertyKeyIssue(s, s.ast, p.name, exit);
  }
  if (exit === sameExit)
    return;
  const value = exit[args];
  if (value !== missing) {
    assignProperty(s.out, p.name, value);
    return;
  }
  delete s.out[p.name];
  if (!isOptional(p.type)) {
    const issue = new Pointer([p.name], new MissingKey(p.type.context?.annotations));
    if (s.options.errors === "all") {
      if (s.issues)
        s.issues.push(issue);
      else
        s.issues = [issue];
      return;
    } else {
      return fail4(new Composite(s.ast, [issue], s.input, s.options));
    }
  }
}
var parsePropertiesOptions = {
  onItem(s, p) {
    if (!hasPropertySignature(s.input, p.name)) {
      return p.parser(missing, s.options);
    }
    const value = s.input[p.name];
    assignProperty(s.out, p.name, value);
    return p.parser(value, s.options);
  },
  step: stepProperty
};
var parseProperties = /* @__PURE__ */ iterateEager()(parsePropertiesOptions);
var parsePropertiesConcurrent = /* @__PURE__ */ iterateConcurrent()(parsePropertiesOptions);
function combineChecks(a, b) {
  if (!a)
    return b;
  if (!b)
    return a;
  return [...a, ...b];
}
function struct(fields, checks, annotations) {
  return new Objects(Reflect.ownKeys(fields).map((key) => {
    return new PropertySignature(key, fields[key].ast);
  }), [], annotations, checks);
}
function getAST(self) {
  return self.ast;
}
function union(members, options, checks) {
  return new Union(members.map(getAST), options, undefined, checks);
}
function structWithRest(ast, records) {
  if (ast.encoding || records.some((r) => r.encoding)) {
    throw new Error("StructWithRest does not support encodings");
  }
  let propertySignatures = ast.propertySignatures;
  let indexSignatures = ast.indexSignatures;
  let checks = ast.checks;
  for (const record of records) {
    for (const propertySignature of record.propertySignatures) {
      if (propertySignatures.some((ps) => ps.name === propertySignature.name)) {
        throw new Error(`Duplicate identifier: ${JSON.stringify(propertySignature.name)}. ts(2300)`);
      }
    }
    propertySignatures = propertySignatures.concat(record.propertySignatures);
    indexSignatures = indexSignatures.concat(record.indexSignatures);
    checks = combineChecks(checks, record.checks);
  }
  return new Objects(propertySignatures, indexSignatures, undefined, checks);
}
var toCandidate = /* @__PURE__ */ memoizeIdempotent((ast) => {
  while (true) {
    if (isSuspend(ast))
      return unknown;
    const encoding = ast.encoding;
    if (!encoding) {
      return ast.recur?.(toCandidate, identity) ?? ast;
    }
    if (encoding.some((link) => link.transformation._tag === "Middleware" && link.transformation.decode !== identity))
      return unknown;
    ast = encoding[encoding.length - 1].to;
  }
});
function getCandidateTypes(ast) {
  switch (ast._tag) {
    case "Null":
      return ["null"];
    case "Undefined":
      return ["undefined"];
    case "String":
    case "TemplateLiteral":
      return ["string"];
    case "Number":
      return ["number"];
    case "Boolean":
      return ["boolean"];
    case "Symbol":
    case "UniqueSymbol":
      return ["symbol"];
    case "BigInt":
      return ["bigint"];
    case "Arrays":
      return ["array"];
    case "ObjectKeyword":
      return ["object", "array", "function"];
    case "Objects":
      return ast.propertySignatures.length || ast.indexSignatures.length ? ["object"] : ["string", "number", "boolean", "symbol", "bigint", "object", "array", "function"];
    case "Enum":
      return Array.from(new Set(ast.enums.map(([, v]) => typeof v)));
    case "Literal":
      return [typeof ast.literal];
    case "Union":
      return Array.from(new Set(ast.types.flatMap(getCandidateTypes)));
    default:
      return ["null", "undefined", "string", "number", "boolean", "symbol", "bigint", "object", "array", "function"];
  }
}
function collectSentinels(ast) {
  switch (ast._tag) {
    default:
      return [];
    case "Declaration": {
      const s = ast.annotations?.[SENTINELS_ANNOTATION_KEY];
      return Array.isArray(s) ? s : [];
    }
    case "Objects":
      return ast.propertySignatures.flatMap((ps) => {
        const type = ps.type;
        if (!isOptional(type)) {
          if (isLiteral(type)) {
            return [{
              key: ps.name,
              literal: type.literal
            }];
          }
          if (isUniqueSymbol(type)) {
            return [{
              key: ps.name,
              literal: type.symbol
            }];
          }
        }
        return [];
      });
    case "Arrays":
      return ast.elements.flatMap((e, i) => {
        if (!isOptional(e)) {
          if (isLiteral(e)) {
            return [{
              key: i,
              literal: e.literal
            }];
          }
          if (isUniqueSymbol(e)) {
            return [{
              key: i,
              literal: e.symbol
            }];
          }
        }
        return [];
      });
    case "Union": {
      if (ast.types.length === 0)
        return [];
      const members = ast.types.map((type) => collectSentinels(toCandidate(type)));
      return members[0].filter((s) => members.every((sentinels) => sentinels.some((o) => o.key === s.key && o.literal === s.literal)));
    }
    case "Suspend":
      return collectSentinels(ast.thunk());
  }
}
var candidateIndexCache = /* @__PURE__ */ new WeakMap;
var emptyCandidates = /* @__PURE__ */ Object.freeze([]);
var getRuntimeType = (input) => input === null ? "null" : Array.isArray(input) ? "array" : typeof input;
var hasPropertySignature = (input, key) => key === "__proto__" ? Object.hasOwn(input, key) : (key in input);
function getCandidateIndex(types) {
  let index = candidateIndexCache.get(types);
  if (index)
    return index;
  let bySentinel;
  let sentinelCandidateCount = 0;
  let otherwise;
  let literalCandidates;
  let onlyLiterals = true;
  const literalOf = [];
  for (let i = 0;i < types.length; i++) {
    const a = types[i];
    const encoded = toCandidate(a);
    if (isNever2(encoded))
      continue;
    if (isLiteral(encoded) || isUniqueSymbol(encoded)) {
      literalCandidates ??= new Map;
      const literal = isLiteral(encoded) ? encoded.literal : encoded.symbol;
      literalOf[i] = literal;
      let arr = literalCandidates.get(literal);
      if (!arr)
        literalCandidates.set(literal, arr = []);
      arr.push(i);
    } else {
      onlyLiterals = false;
    }
    const sentinels = collectSentinels(encoded);
    if (sentinels.length) {
      bySentinel ??= new Map;
      sentinelCandidateCount++;
      for (const {
        key,
        literal
      } of sentinels) {
        let entry = bySentinel.get(key);
        if (!entry)
          bySentinel.set(key, entry = [new Map, new Set]);
        entry[1].add(i);
        let indexes = entry[0].get(literal);
        if (!indexes)
          entry[0].set(literal, indexes = new Set);
        indexes.add(i);
      }
    } else {
      otherwise ??= {};
      const candidateTypes = getCandidateTypes(encoded);
      for (const t of candidateTypes)
        (otherwise[t] ??= []).push(i);
    }
  }
  const fallbacks = {};
  const getFallback = (type) => fallbacks[type] ??= Object.freeze(otherwise?.[type] ?? emptyCandidates);
  if (onlyLiterals && literalCandidates) {
    literalCandidates.forEach(Object.freeze);
    index = (input) => literalCandidates.get(input) ?? emptyCandidates;
  } else if (bySentinel?.size === 1 && !otherwise) {
    const [key, [byValue]] = bySentinel.entries().next().value;
    const candidates = new Map;
    for (const [literal, indexes] of byValue) {
      candidates.set(literal, Object.freeze(Array.from(indexes)));
    }
    const all = Object.freeze(types.map((_, i) => i));
    index = (input, isConstructor) => {
      if (isObjectKeyword(input)) {
        const value = hasPropertySignature(input, key) ? input[key] : undefined;
        if (value !== undefined)
          return candidates.get(value) ?? emptyCandidates;
        if (isConstructor)
          return all;
      }
      return emptyCandidates;
    };
  } else if (bySentinel) {
    let commonSentinel;
    for (const entry of bySentinel) {
      if ((!commonSentinel || entry[1][0].size > commonSentinel[1][0].size) && entry[1][1].size === sentinelCandidateCount) {
        commonSentinel = entry;
      }
    }
    index = (input, isConstructor) => {
      const runtimeType = getRuntimeType(input);
      if (!isObjectKeyword(input))
        return getFallback(runtimeType);
      const selected = new Set(otherwise?.[runtimeType]);
      let directKey;
      if (commonSentinel) {
        const [key, [byValue]] = commonSentinel;
        const hasKey = hasPropertySignature(input, key);
        const value = hasKey ? input[key] : undefined;
        if (hasKey && (!isConstructor || value !== undefined)) {
          const match = byValue.get(value);
          if (!match)
            return getFallback(runtimeType);
          for (const i of match)
            selected.add(i);
          directKey = key;
        }
      }
      if (directKey === undefined) {
        for (const [key, [byValue, all]] of bySentinel) {
          const hasKey = hasPropertySignature(input, key);
          const value = hasKey ? input[key] : undefined;
          if (hasKey && (!isConstructor || value !== undefined)) {
            const match = byValue.get(value);
            if (match) {
              for (const i of match)
                selected.add(i);
            }
          } else if (isConstructor) {
            for (const i of all)
              selected.add(i);
          }
        }
      }
      for (const [key, [byValue, all]] of bySentinel) {
        if (key === directKey)
          continue;
        const hasKey = hasPropertySignature(input, key);
        const value = hasKey ? input[key] : undefined;
        if (hasKey && (!isConstructor || value !== undefined)) {
          const match = byValue.get(value);
          for (const i of selected) {
            if (all.has(i) && !match?.has(i))
              selected.delete(i);
          }
        }
      }
      return Array.from(selected).sort((a, b) => a - b);
    };
  } else {
    index = (input) => {
      const fallback = getFallback(getRuntimeType(input));
      return literalCandidates ? fallback.filter((i) => literalOf[i] === undefined || literalOf[i] === input) : fallback;
    };
  }
  candidateIndexCache.set(types, index);
  return index;
}
var Union = class extends ASTNodeImpl {
  _tag = "Union";
  types;
  options;
  encodingChecks;
  constructor(types, options, annotations, checks, encoding, context, encodingChecks) {
    super(annotations, checks, encoding, context);
    this.types = types;
    this.options = options;
    this.encodingChecks = encodingChecks;
  }
  getParser(compile, compileField) {
    const ast = this;
    const isConstructor = compileField !== undefined;
    const parsers = [];
    const parser = (i) => parsers[i] ??= compile(ast.types[i]);
    let index;
    return (input, options) => {
      if (input === missing) {
        return missingExit;
      }
      const candidates = (index ??= getCandidateIndex(ast.types))(input, isConstructor);
      if (candidates.length === 0) {
        return fail5(new AnyOf(ast, [], input, options));
      }
      if (candidates.length === 1) {
        const result = parser(candidates[0])(input, options);
        if (result._tag === "Success")
          return result;
        return effectIsExit(result) ? failSingleUnionCandidate(ast, result.cause, input, options) : catchSingleUnionCandidate(ast, result, input, options);
      }
      return parseUnionCandidates(ast, parser, candidates, input, options);
    };
  }
  _rebuild(recur, checks, encodingChecks) {
    const types = mapOrSame(this.types, recur);
    return types === this.types && checks === this.checks && encodingChecks === this.encodingChecks ? this : new Union(types, this.options, this.annotations, checks, undefined, this.context, encodingChecks);
  }
  recur(recur) {
    return this._rebuild(recur, this.checks, this.encodingChecks);
  }
  flip(recur) {
    return this._rebuild(recur, this.encodingChecks, this.checks);
  }
  matchPart(s, options) {
    for (const type of this.types) {
      const out = type.matchPart(s, options);
      if (out !== undefined)
        return out;
    }
    return;
  }
  getExpected(getExpected) {
    const expected = this.annotations?.expected;
    if (typeof expected === "string")
      return expected;
    if (this.types.length === 0)
      return "never";
    const types = this.types.map((type) => {
      const encoded = toEncoded(type);
      switch (encoded._tag) {
        case "Arrays": {
          const literals = encoded.elements.filter(isLiteral);
          if (literals.length > 0) {
            return `${formatIsMutable(encoded.isMutable)}[ ${literals.map((e) => getExpected(e) + formatIsOptional(e.context?.isOptional)).join(", ")}, ... ]`;
          }
          break;
        }
        case "Objects": {
          const literals = encoded.propertySignatures.filter((ps) => isLiteral(ps.type));
          if (literals.length > 0) {
            return `{ ${literals.map((ps) => `${formatIsMutable(ps.type.context?.isMutable)}${formatPropertyKey(ps.name)}${formatIsOptional(ps.type.context?.isOptional)}: ${getExpected(ps.type)}`).join(", ")}, ... }`;
          }
          break;
        }
      }
      return getExpected(encoded);
    });
    return Array.from(new Set(types)).join(" | ");
  }
};
function failSingleUnionCandidate(ast, cause, input, options) {
  const issue = getSchemaIssue(cause);
  if (!issue)
    return failCause2(cause);
  return fail4(new AnyOf(ast, [issue], input, options));
}
function catchSingleUnionCandidate(ast, result, input, options) {
  return catchCause2(result, (cause) => failSingleUnionCandidate(ast, cause, input, options));
}
function parseUnionCandidates(ast, parser, candidates, input, options) {
  const state = {
    ast,
    parser,
    input,
    out: undefined,
    successes: ast.options?.mode === "oneOf" ? [] : undefined,
    issues: undefined,
    options
  };
  const eff = parseUnion(state, candidates);
  if (!eff) {
    if (state.out)
      return state.out;
    return fail5(new AnyOf(ast, state.issues ?? [], input, options));
  }
  if (effectIsExit(eff))
    return resumeUnion(eff, state);
  let first = true;
  return suspend2(() => {
    if (!first)
      return parseUnionCandidates(ast, parser, candidates, input, options);
    first = false;
    return resumeUnion(eff, state);
  });
}
function resumeUnion(eff, state) {
  return flatMapEager2(eff, (_) => {
    if (state.out === sameExit)
      return succeed5(state.input);
    if (state.out)
      return state.out;
    return fail5(new AnyOf(state.ast, state.issues ?? [], state.input, state.options));
  });
}
var parseUnion = /* @__PURE__ */ iterateEager()({
  onItem(s, i) {
    return s.parser(i)(s.input, s.options);
  },
  step(s, i, exit) {
    if (exit._tag === "Failure") {
      const issue = getSchemaIssue(exit.cause);
      if (issue === undefined) {
        return exit;
      }
      if (s.issues)
        s.issues.push(issue);
      else
        s.issues = [issue];
    } else {
      if (s.out && s.successes) {
        s.successes.push(s.ast.types[i]);
        return fail4(new OneOf(s.ast, s.successes, s.input, s.options));
      }
      s.out = exit;
      if (s.successes) {
        s.successes.push(s.ast.types[i]);
      } else {
        return void_2;
      }
    }
  }
});
var nonFiniteLiterals = /* @__PURE__ */ new Union([/* @__PURE__ */ new Literal("Infinity"), /* @__PURE__ */ new Literal("-Infinity"), /* @__PURE__ */ new Literal("NaN")]);
function formatIsMutable(isMutable) {
  return isMutable ? "" : "readonly ";
}
function formatIsOptional(isOptional) {
  return isOptional ? "?" : "";
}
var Filter2 = class extends Class {
  _tag = "Filter";
  run;
  annotations;
  aborted;
  constructor(run, annotations = undefined, aborted = false) {
    super();
    this.run = run;
    this.annotations = annotations;
    this.aborted = aborted;
  }
  annotate(annotations) {
    return new Filter2(this.run, {
      ...this.annotations,
      ...annotations
    }, this.aborted);
  }
  abort() {
    return new Filter2(this.run, this.annotations, true);
  }
  and(other, annotations) {
    return new FilterGroup([this, other], annotations);
  }
};
var FilterGroup = class extends Class {
  _tag = "FilterGroup";
  checks;
  annotations;
  constructor(checks, annotations = undefined) {
    super();
    this.checks = checks;
    this.annotations = annotations;
  }
  annotate(annotations) {
    return new FilterGroup(this.checks, {
      ...this.annotations,
      ...annotations
    });
  }
  and(other, annotations) {
    return new FilterGroup([this, other], annotations);
  }
};
function makeFilter(filter, annotations, aborted = false) {
  return new Filter2((input, ast, options) => normalizeFilterOutput(ast, filter(input, ast, options), input, options), annotations, aborted);
}
function isFinite(annotations) {
  return makeFilter((n) => globalThis.Number.isFinite(n), {
    expected: "a finite number",
    representation: {
      id: "effect/schema/isFinite",
      payload: null
    },
    toJsonSchema: () => ({
      type: "number"
    }),
    toCode: () => ({
      runtime: "Schema.isFinite()"
    }),
    arbitraryConstraint: {
      number: "finite"
    },
    ...annotations
  });
}
var finite = /* @__PURE__ */ appendChecks(number2, [/* @__PURE__ */ isFinite()]);
var numberToJson = /* @__PURE__ */ new Link(/* @__PURE__ */ new Union([finite, nonFiniteLiterals]), /* @__PURE__ */ new Transformation(/* @__PURE__ */ Number3(), /* @__PURE__ */ transform((n) => globalThis.Number.isFinite(n) ? n : globalThis.String(n))));
function isPattern(regExp, annotations) {
  const copy = new globalThis.RegExp(regExp);
  const payload = {
    source: copy.source,
    flags: copy.flags
  };
  return makeFilter((s) => {
    copy.lastIndex = 0;
    return copy.test(s);
  }, {
    expected: `a string matching the RegExp ${payload.source}`,
    representation: {
      id: "effect/schema/isPattern",
      payload
    },
    toJsonSchema: () => [{}, true],
    arbitraryConstraint: {
      patterns: [payload]
    },
    ...annotations
  });
}
var bodyOwners = /* @__PURE__ */ new WeakMap;
function copy(ast, changes) {
  const out = Object.assign(Object.create(Object.getPrototypeOf(ast)), ast, changes);
  if (Reflect.ownKeys(changes).every((key) => key === "context" || key === "encoding")) {
    bodyOwners.set(out, getContextOwner(ast));
  }
  return out;
}
function getContextOwner(ast) {
  const existing = bodyOwners.get(ast);
  if (existing !== undefined)
    return existing;
  if (ast.encoding === undefined)
    return ast;
  const owner = Object.assign(Object.create(Object.getPrototypeOf(ast)), ast, {
    encoding: undefined
  });
  bodyOwners.set(ast, owner);
  return owner;
}
function replaceEncoding(ast, encoding) {
  return ast.encoding === encoding ? ast : copy(ast, {
    encoding
  });
}
function replaceContext(ast, context) {
  if (ast.context === context) {
    return ast;
  }
  const owner = getContextOwner(ast);
  if (owner.context === context && owner.encoding === ast.encoding) {
    return owner;
  }
  return copy(ast, {
    context
  });
}
function getLastEncoding(ast) {
  return ast.encoding ? getLastEncoding(ast.encoding[ast.encoding.length - 1].to) : ast;
}
function annotate(ast, annotations) {
  if (ast.checks) {
    const last = ast.checks[ast.checks.length - 1];
    return replaceChecks(ast, append(ast.checks.slice(0, -1), last.annotate(annotations)));
  }
  return copy(ast, {
    annotations: {
      ...ast.annotations,
      ...annotations
    }
  });
}
function replaceChecks(ast, checks) {
  if (ast._tag === "Suspend" && checks) {
    throw new Error("Cannot add checks to Suspend");
  }
  if (ast.checks === checks) {
    return ast;
  }
  return copy(ast, {
    checks
  });
}
function appendChecks(ast, checks) {
  return replaceChecks(ast, combineChecks(ast.checks, checks));
}
function mapLink(link, f) {
  const to = f(link.to);
  return to === link.to ? link : new Link(to, link.transformation);
}
function updateLastLink(encoding, f) {
  const links = encoding;
  const last = links[links.length - 1];
  const out = mapLink(last, f);
  return out === last ? encoding : append(encoding.slice(0, encoding.length - 1), out);
}
function applyToLastLink(f) {
  return (ast) => ast.encoding ? replaceEncoding(ast, updateLastLink(ast.encoding, f)) : ast;
}
function applyToSelfOrLastLinkEncodingIdempotent(f, options) {
  function out(ast) {
    if (ast.encoding) {
      const last = ast.encoding[ast.encoding.length - 1];
      return options?.stopAt?.(last) ? ast : replaceEncoding(ast, updateLastLink(ast.encoding, out));
    }
    return f(ast);
  }
  return memoizeIdempotent(out);
}
function appendTransformation(from, transformation, to) {
  const link = new Link(from, transformation);
  return replaceEncoding(to, to.encoding ? [...to.encoding, link] : [link]);
}
function mapOrSame(as, f) {
  let out;
  for (let i = 0;i < as.length; i++) {
    const a = as[i];
    const fa = f(a);
    if (out) {
      out[i] = fa;
    } else if (fa !== a) {
      out = new Array(as.length);
      for (let j = 0;j < i; j++) {
        out[j] = as[j];
      }
      out[i] = fa;
    }
  }
  return out ?? as;
}
function annotateKey(ast, annotations) {
  const context = ast.context ? new Context(ast.context.isOptional, ast.context.isMutable, ast.context.constructorDefault, {
    ...ast.context.annotations,
    ...annotations
  }) : new Context(false, false, undefined, annotations);
  return replaceContext(ast, context);
}
var optionalKey = /* @__PURE__ */ memoizeIdempotent((ast) => {
  const context = ast.context ? ast.context.isOptional === false ? new Context(true, ast.context.isMutable, ast.context.constructorDefault, ast.context.annotations) : ast.context : new Context(true, false);
  return optionalKeyLastLink(replaceContext(ast, context));
});
var optionalKeyLastLink = /* @__PURE__ */ applyToLastLink(optionalKey);
var optional = /* @__PURE__ */ memoize((ast) => optionalKey(new Union([ast, undefined_2])));
function decodeTo(from, to, transformation) {
  return appendTransformation(from, transformation, to);
}
function parseParameter(ast) {
  const literals = [];
  const parameters = [];
  function addLiteral(literal) {
    if (!literals.includes(literal)) {
      literals.push(literal);
    }
  }
  function go(ast) {
    switch (ast._tag) {
      case "Literal":
        if (isPropertyKey(ast.literal)) {
          addLiteral(ast.literal);
        }
        return;
      case "UniqueSymbol":
        addLiteral(ast.symbol);
        return;
      case "Enum":
        for (const [, value] of ast.enums) {
          addLiteral(value);
        }
        return;
      case "Never":
        return;
      case "Union":
        for (let i = 0;i < ast.types.length; i++) {
          go(ast.types[i]);
        }
        return;
      default:
        parameters.push(ast);
    }
  }
  go(ast);
  return {
    literals,
    parameters
  };
}
function record(key, value) {
  const {
    literals,
    parameters: indexSignatures
  } = parseParameter(key);
  return new Objects(literals.map((literal) => new PropertySignature(literal, value)), indexSignatures.map((parameter) => new IndexSignature(parameter, value)));
}
function isOptional(ast) {
  return ast.context?.isOptional ?? false;
}
function isStructuralCheck(check) {
  return check.annotations?.[STRUCTURAL_ANNOTATION_KEY] === true || check._tag === "FilterGroup" && check.checks.every(isStructuralCheck);
}
function extractStructuralChecks(checks) {
  function extract(check) {
    if (isStructuralCheck(check))
      return [check];
    return check._tag === "FilterGroup" ? check.checks.flatMap(extract) : [];
  }
  const out = checks.flatMap(extract);
  return isArrayNonEmpty2(out) ? out : undefined;
}
function canPreserveEncodingChecks(ast) {
  let preserve = true;
  function visit(child) {
    preserve = preserve && !child.encoding && !isSuspend(child);
    if (preserve && "recur" in child)
      child.recur(visit);
    return child;
  }
  if ("recur" in ast)
    ast.recur(visit);
  return preserve;
}
var toType = /* @__PURE__ */ memoizeIdempotent((ast) => {
  const owner = getContextOwner(ast);
  if (owner !== ast) {
    const type = toType(owner);
    return type === owner && ast.encoding === undefined ? ast : replaceContext(type, ast.context);
  }
  const type = "recur" in ast ? ast.recur(toType) : ast;
  if ("encodingChecks" in type && type.encodingChecks) {
    const checks = canPreserveEncodingChecks(ast) ? type.encodingChecks : isArrays(type) || isObjects(type) || isDeclaration(type) && type.typeParameters.length > 0 ? extractStructuralChecks(type.encodingChecks) : undefined;
    return copy(type, {
      encodingChecks: undefined,
      checks: combineChecks(type.checks, checks)
    });
  }
  return type;
});
var toEncoded = /* @__PURE__ */ memoizeIdempotent((ast) => {
  return toType(flip2(ast));
});
function flipEncoding(ast, encoding) {
  const links = encoding;
  const len = links.length;
  const last = links[len - 1];
  const ls = [new Link(flip2(replaceEncoding(ast, undefined)), links[0].transformation.flip())];
  for (let i = 1;i < len; i++) {
    ls.unshift(new Link(flip2(links[i - 1].to), links[i].transformation.flip()));
  }
  const to = flip2(last.to);
  if (to.encoding) {
    return replaceEncoding(to, [...to.encoding, ...ls]);
  } else {
    return replaceEncoding(to, ls);
  }
}
var flip2 = /* @__PURE__ */ memoize((ast) => {
  if (ast.encoding) {
    return flipEncoding(ast, ast.encoding);
  }
  const owner = getContextOwner(ast);
  if (owner !== ast) {
    const flipped = flip2(owner);
    return flipped === owner ? ast : replaceContext(flipped, ast.context);
  }
  return "flip" in ast ? ast.flip(flip2) : ("recur" in ast) ? ast.recur(flip2) : ast;
});
function fromConst(ast, value) {
  const succeed = value === 0 ? sameExit : succeed6(value);
  return (input, options) => {
    if (input === missing)
      return missingExit;
    if (input === value)
      return succeed;
    return fail5(new InvalidType(ast, input, options));
  };
}
function fromRefinement(ast, refinement) {
  return (input, options) => {
    if (input === missing)
      return missingExit;
    if (refinement(input))
      return sameExit;
    return fail5(new InvalidType(ast, input, options));
  };
}
function segmentTemplateLiteralParts(ast, input, options) {
  const parts = ast.encodedParts;
  const literals = ast.literals;
  const inputLength = input.length;
  for (let i = 0;i < literals.length; i++) {
    const literal = literals[i];
    if (literal && !input.includes(literal))
      return;
  }
  if (ast.suffixLengths[0] > inputLength)
    return;
  const out = new Array(parts.length);
  let failures;
  function go(i, pos) {
    if (i === parts.length)
      return pos === inputLength;
    if (failures?.has(i * (inputLength + 1) + pos))
      return false;
    const part = parts[i];
    if (i === parts.length - 1) {
      const s = input.slice(pos);
      if (part.matchPart(s, options) !== undefined) {
        out[i] = s;
        return true;
      }
    } else if (part._tag === "Literal") {
      const s = literals[i];
      if (input.startsWith(s, pos) && go(i + 1, pos + s.length)) {
        out[i] = s;
        return true;
      }
    } else {
      const maximumEnd = inputLength - ast.suffixLengths[i + 1];
      const anchor = literals[i + 1];
      let end = anchor === undefined ? maximumEnd : input.lastIndexOf(anchor, maximumEnd);
      while (end >= pos) {
        const s = input.slice(pos, end);
        if (part.matchPart(s, options) !== undefined && go(i + 1, end)) {
          out[i] = s;
          return true;
        }
        if (end === 0)
          break;
        end = anchor === undefined ? end - 1 : input.lastIndexOf(anchor, end - 1);
      }
    }
    failures ??= new Set;
    failures.add(i * (inputLength + 1) + pos);
    return false;
  }
  return go(0, 0) ? out : undefined;
}
var parameterFromPropertyKey = /* @__PURE__ */ applyToSelfOrLastLinkEncodingIdempotent((ast) => {
  switch (ast._tag) {
    default:
      return ast;
    case "Number":
      return ast.toCodecStringTree();
    case "Union":
      return ast.recur(parameterFromPropertyKey);
  }
});
var partFromString = /* @__PURE__ */ applyToSelfOrLastLinkEncodingIdempotent((ast) => {
  switch (ast._tag) {
    default:
      return ast;
    case "Number":
    case "Literal":
    case "BigInt":
      return ast.toCodecStringTree();
    case "Union":
      return ast.recur(partFromString);
  }
});
var isStringFiniteRegExp = /* @__PURE__ */ new globalThis.RegExp(`^${FINITE_PATTERN}$`);
var isStringNumberRegExp = /* @__PURE__ */ new globalThis.RegExp(`^(?:${FINITE_PATTERN}|Infinity|-Infinity|NaN)$`);
function isStringFinite(annotations) {
  return isPattern(isStringFiniteRegExp, {
    expected: "a string representing a finite number",
    representation: {
      id: "effect/schema/isStringFinite",
      payload: null
    },
    toJsonSchema: () => ({
      pattern: isStringFiniteRegExp.source
    }),
    ...annotations
  });
}
var finiteString = /* @__PURE__ */ appendChecks(string2, [/* @__PURE__ */ isStringFinite()]);
var finiteToString = /* @__PURE__ */ new Link(finiteString, numberFromString);
var numberToString = /* @__PURE__ */ new Link(/* @__PURE__ */ new Union([finiteString, nonFiniteLiterals]), numberFromString);
var BIGINT_PATTERN = "-?\\d+";
var isStringBigIntRegExp = /* @__PURE__ */ new globalThis.RegExp(`^${BIGINT_PATTERN}$`);
var REGEXP_PATTERN = "Symbol\\(([\\s\\S]*)\\)";
var isStringSymbolRegExp = /* @__PURE__ */ new globalThis.RegExp(`^${REGEXP_PATTERN}$`);
function collectIssues(checks, value, issues, ast, options) {
  for (let i = 0;i < checks.length; i++) {
    const check = checks[i];
    if (check._tag === "FilterGroup") {
      issues = collectIssues(check.checks, value, issues, ast, options);
      if (issues && (options.errors !== "all" || issues[issues.length - 1].filter.aborted)) {
        return issues;
      }
    } else {
      const issue = check.run(value, ast, options);
      if (issue) {
        const filter = new Filter(check, issue, value, options);
        if (issues)
          issues.push(filter);
        else
          issues = [filter];
        if (options.errors !== "all" || check.aborted) {
          return issues;
        }
      }
    }
  }
  return issues;
}
function getConstructorDescriptor(ast) {
  if (!isDeclaration(ast))
    return;
  const getDescriptor = ast.annotations?.[CONSTRUCTOR_ANNOTATION_KEY];
  return isFunction(getDescriptor) ? getDescriptor(ast.typeParameters) : undefined;
}

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/internal/schema/interpreter.js
var flatMapTransformation = (result, current, f) => result === sameExit ? f(current) : flatMapEager2(result, f);
function compileTransformation(transformation) {
  const apply = compileTransformationUnsafe(transformation);
  return (result, current, options) => {
    try {
      return apply(result, current, options);
    } catch (error) {
      return die3(error);
    }
  };
}
function compileTransformationUnsafe(transformation) {
  if (transformation._tag === "Middleware") {
    return (result, current, options) => {
      const transformed = result === sameExit ? transformation.decode(succeed6(toOption(current)), options) : transformation.decode(mapEager2(result, toOption), options);
      return fromOptionalEffect(transformed);
    };
  }
  const getter = transformation.decode;
  switch (getter._tag) {
    case "Passthrough":
      return (result, current) => result === sameExit ? succeed6(current) : result;
    case "Transform": {
      const transform = (value) => value === missing ? missingExit : succeed6(getter.transform(value));
      return (result, current) => flatMapTransformation(result, current, transform);
    }
    case "TransformOptional": {
      const transform = (value) => fromOptionExit(getter.transform(toOption(value)));
      return (result, current) => flatMapTransformation(result, current, transform);
    }
    case "TransformEffect":
      return (result, current, options) => flatMapTransformation(result, current, (value) => value === missing ? missingExit : getter.transform(value, options));
    case "TransformOptionalEffect":
      return (result, current, options) => flatMapTransformation(result, current, (value) => fromOptionalEffect(getter.transform(toOption(value), options)));
  }
}
var fromOptionalEffect = (effect) => flatMapEager2(effect, fromOptionExit);
var wrapEncoding = (ast, input, options, effect) => catchCause2(effect, (cause) => failCauseSync2(() => map3(cause, (issue) => new Encoding(ast, issue, input, options))));
function makeConstructorParser(descriptor, compile) {
  const transform = compileTransformation(descriptor.link.transformation);
  let sourceParser;
  return (input, options) => {
    if (input === missing)
      return missingExit;
    if (descriptor.isConstructed(input))
      return sameExit;
    const result = (sourceParser ??= compile(descriptor.link.to))(input, options);
    return transform(result, input, options);
  };
}
function withDefault(ast, parser) {
  const defaultValue = ast.context.constructorDefault;
  return (input, options) => {
    if (input !== missing && input !== undefined)
      return parser(input, options);
    const result = defaultValue;
    if (effectIsExit(result) && result._tag === "Success") {
      const local = parser(result[args], options);
      return local === sameExit ? result : local;
    }
    return flatMapEager2(wrapEncoding(ast, input, options, result), (value) => {
      const local = parser(value, options);
      return local === sameExit ? succeed6(value) : local;
    });
  };
}
function compileField(ast, compile) {
  const parser = compile(ast);
  return ast.context?.constructorDefault === undefined ? parser : withDefault(ast, parser);
}
function compile(ast, compile, compileField, base, specialize) {
  if (ast._tag === "Declaration") {
    for (const parameter of ast.typeParameters)
      compile(parameter);
  }
  const descriptor = compileField ? getConstructorDescriptor(ast) : undefined;
  const parser = descriptor ? makeConstructorParser(descriptor, compile) : base ?? ast.getParser(compile, compileField);
  const checks = ast.checks;
  const links = ast.encoding;
  const transformations = links?.map((link) => compileTransformation(link.transformation));
  const encodingChecks = ast.encodingChecks;
  if (!links && !checks && !encodingChecks) {
    return parser;
  }
  let encodingParsers;
  const parseChecks = (input, options) => {
    let result = parser(input, options);
    try {
      if (encodingChecks && !options.disableChecks) {
        if (effectIsExit(result)) {
          if (result._tag === "Success") {
            const output = result === sameExit ? input : result[args];
            if (input !== missing && output !== missing) {
              const issues = collectIssues(encodingChecks, input, undefined, ast, options);
              if (issues) {
                result = fail5(new Composite(ast, issues, input, options));
              }
            }
          }
        } else {
          result = flatMap2(result, (value) => {
            if (input !== missing && value !== missing) {
              const issues = collectIssues(encodingChecks, input, undefined, ast, options);
              if (issues) {
                return fail5(new Composite(ast, issues, input, options));
              }
            }
            return succeed5(value);
          });
        }
      }
      if (checks && !options.disableChecks) {
        if (effectIsExit(result)) {
          if (result._tag === "Success") {
            const value = result === sameExit ? input : result[args];
            if (value === missing)
              return result;
            const issues = collectIssues(checks, value, undefined, ast, options);
            if (issues) {
              result = fail5(new Composite(ast, issues, value, options));
            }
          }
        } else {
          result = flatMap2(result, (value) => {
            if (value !== missing) {
              const issues = collectIssues(checks, value, undefined, ast, options);
              if (issues) {
                return fail5(new Composite(ast, issues, value, options));
              }
            }
            return succeed5(value);
          });
        }
      }
      return result;
    } catch (error) {
      return die3(error);
    }
  };
  const parseLocal = specialize === undefined ? parseChecks : specialize(parseChecks);
  if (!links) {
    return parseLocal;
  }
  return (input, options) => {
    const parsers = encodingParsers ??= links.map((link) => compile(link.to));
    let current = input;
    let result = parsers[parsers.length - 1](input, options);
    for (let i = links.length - 1;i >= 0; i--) {
      result = transformations[i](result, current, options);
      if (i !== 0) {
        const next = parsers[i - 1];
        if (result._tag === "Success") {
          current = result[args];
          result = next(current, options);
        } else {
          result = flatMapEager2(result, (value) => {
            const nextResult = next(value, options);
            return nextResult === sameExit ? succeed6(value) : nextResult;
          });
        }
      }
    }
    if (result._tag === "Success") {
      const value = result[args];
      const local = parseLocal(value, options);
      return local === sameExit ? result : local;
    }
    result = wrapEncoding(ast, input, options, result);
    return flatMapEager2(result, (value) => {
      const local = parseLocal(value, options);
      return local === sameExit ? succeed6(value) : local;
    });
  };
}

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/internal/schema/compilerRegistry.js
var invalid = /* @__PURE__ */ Symbol();
var cache = /* @__PURE__ */ new WeakMap;
var compiler;
var compilerAdaptersEnabled = false;
var decodeChild = (ast) => compilerAdaptersEnabled ? lazyParser(resolve2, ast, "parser") : resolve2(ast).parser;
var makeChild = (ast) => compilerAdaptersEnabled ? lazyParser(resolve2, ast, "makeEffect") : resolve2(ast).makeEffect;
var makeField = (ast) => compileField(ast, makeChild);

class InterpretedEntry {
  ast;
  constructor(ast) {
    this.ast = ast;
  }
  get decodeEffect() {
    return this.cachedDecodeEffect ??= compile(this.ast, decodeChild);
  }
  get parser() {
    return this.decodeEffect;
  }
  get makeEffect() {
    return this.cachedMakeEffect ??= compile(this.ast, makeChild, makeField);
  }
}

class CompilerEntry extends InterpretedEntry {
  compiled;
  resolve;
  constructor(ast, compiled, resolve) {
    super(ast);
    this.compiled = compiled;
    this.resolve = resolve;
  }
  save(key, value) {
    Object.defineProperty(this, key, {
      value
    });
    return value;
  }
  operation(key) {
    const compiled = this.compiled;
    return typeof compiled === "function" ? compiled(this.ast, this.resolve, key) : compiled?.[key];
  }
  get is() {
    return this.save("is", this.operation("is"));
  }
  get decode() {
    return this.save("decode", this.operation("decode"));
  }
  get make() {
    return this.save("make", this.operation("make"));
  }
  get compiledMakeEffect() {
    return this.save("compiledMakeEffect", this.operation("makeEffect"));
  }
  get decodeEffect() {
    return this.save("decodeEffect", this.operation("decodeEffect") ?? compile(this.ast, (ast) => lazyParser(this.resolve, ast, "parser")));
  }
  get parser() {
    const decode = this.decode;
    return decode === undefined ? this.decodeEffect : this.save("parser", withDecode(decode, () => this.decodeEffect));
  }
  get makeEffect() {
    const makeEffect = this.compiledMakeEffect;
    if (makeEffect !== undefined)
      return this.save("makeEffect", makeEffect);
    const child = (ast) => lazyParser(this.resolve, ast, "makeEffect");
    return this.save("makeEffect", compile(this.ast, child, (ast) => compileField(ast, child)));
  }
}
function withDecode(fastDecode, decodeEffect) {
  let detailed;
  return (input, options) => {
    if (input !== missing) {
      try {
        const value = fastDecode(input, options);
        if (value !== invalid)
          return value === input ? sameExit : succeed6(value);
      } catch (error) {
        return die3(error);
      }
    }
    return (detailed ??= decodeEffect())(input, options);
  };
}
function lazyParser(resolve, ast, operation) {
  const entry = resolve(ast);
  if (entry.compiled === undefined || Object.hasOwn(entry, operation)) {
    return entry[operation];
  }
  let parser;
  return (input, options) => (parser ??= entry[operation])(input, options);
}
function resolve2(ast) {
  const cached = cache.get(ast);
  if (cached !== undefined)
    return cached;
  const entry = compiler === undefined ? new InterpretedEntry(ast) : new CompilerEntry(ast, compiler(ast, resolve2), resolve2);
  cache.set(ast, entry);
  return entry;
}

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/SchemaParser.js
function makeEffect(schema) {
  const ast = schema.ast;
  let parser;
  return (input, options) => {
    return (parser ??= runWithCompiler(constructorCompiler, toType(ast)))(input, options?.disableChecks ? options?.parseOptions ? {
      ...options.parseOptions,
      disableChecks: true
    } : {
      disableChecks: true
    } : options?.parseOptions);
  };
}
function makeOption(schema) {
  const parser = makeEffect(schema);
  return (input, options) => {
    const exit = runSyncExit2(parser(input, options));
    if (isSuccess3(exit)) {
      return some2(exit.value);
    }
    getSchemaIssueOrThrow(exit.cause, "Option adapter can only return none for schema issues");
    return none2();
  };
}
function make5(schema) {
  return makeConstructorSync(toType(schema.ast));
}
function decodeUnknownEffect(schema, options) {
  const parser = run(schema.ast);
  return options === undefined ? parser : (input, overrideOptions) => parser(input, mergeParseOptions(options, overrideOptions));
}
var mergeParseOptions = (options, overrideOptions) => overrideOptions ? {
  ...options,
  ...overrideOptions
} : options;
var getValue = (value) => {
  if (value === missing) {
    return fail5(new InvalidValue);
  }
  return succeed5(value);
};
function run(ast) {
  return runWithCompiler(normalCompiler, ast);
}
function parserResult(result, input) {
  if (result === sameExit) {
    return succeed5(input);
  }
  if (!effectIsExit(result)) {
    return flatMapEager2(result, getValue);
  }
  return result[args] === missing ? getValue(missing) : result;
}
function runWithCompiler(compiler, ast) {
  let parser;
  return (input, options) => {
    const result = (parser ??= compiler(ast))(input, options ?? defaultParseOptions);
    if (result === sameExit) {
      return succeed5(input);
    }
    if (!effectIsExit(result)) {
      return flatMapEager2(result, getValue);
    }
    return result[args] === missing ? getValue(missing) : result;
  };
}
function runSync2(effect, message) {
  const exit = runSyncExit2(effect);
  if (isSuccess3(exit)) {
    return exit.value;
  }
  const issue = getSchemaIssueOrThrow(exit.cause, message);
  throw new Error("Schema validation failed", {
    cause: issue
  });
}
var constructorDefectMessage = "Constructor adapter can only throw schema issues";
function throwConstructorDefect(error) {
  throw new Error(constructorDefectMessage, {
    cause: die2(error)
  });
}
function makeConstructorSync(ast) {
  let entry;
  return (input, options) => constructSync(entry ??= resolve2(ast), input, options);
}
function constructSync(entry, input, options) {
  const parseOptions = options?.disableChecks ? options.parseOptions ? {
    ...options.parseOptions,
    disableChecks: true
  } : {
    disableChecks: true
  } : options?.parseOptions ?? defaultParseOptions;
  const make = entry.make;
  if (make !== undefined && input !== missing) {
    let output;
    try {
      output = make(input, parseOptions);
    } catch (error) {
      throwConstructorDefect(error);
    }
    if (output !== invalid && output !== missing)
      return output;
  }
  return runSync2(parserResult(entry.makeEffect(input, parseOptions), input), constructorDefectMessage);
}
var normalCompiler = (ast) => resolve2(ast).parser;
var constructorCompiler = (ast) => resolve2(ast).makeEffect;

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/internal/schema/make.js
var TypeId8 = "~effect/Schema/Schema";
var RebuildOptions = /* @__PURE__ */ Symbol();
var SchemaProto = {
  [TypeId8]: TypeId8,
  get make() {
    const value = make5(this);
    Object.defineProperty(this, "make", {
      value,
      enumerable: true
    });
    return value;
  },
  get makeEffect() {
    const value = makeEffect(this);
    Object.defineProperty(this, "makeEffect", {
      value,
      enumerable: true
    });
    return value;
  },
  get makeOption() {
    const value = makeOption(this);
    Object.defineProperty(this, "makeOption", {
      value,
      enumerable: true
    });
    return value;
  },
  pipe() {
    return pipeArguments(this, arguments);
  },
  annotate(annotations) {
    return this.rebuild(annotate(this.ast, annotations));
  },
  annotateKey(annotations) {
    return this.rebuild(annotateKey(this.ast, annotations));
  },
  check(...checks) {
    return this.rebuild(appendChecks(this.ast, checks));
  },
  rebuild(ast) {
    return make6(ast, this[RebuildOptions]);
  }
};
function make6(ast, options) {
  function Schema() {}
  const self = Object.setPrototypeOf(Schema, SchemaProto);
  if (options && (Object.hasOwn(options, "name") || Object.hasOwn(options, "length") || Object.hasOwn(options, "__proto__"))) {
    Object.defineProperties(self, Object.getOwnPropertyDescriptors({
      ...options
    }));
  } else {
    Object.assign(self, options);
  }
  self[RebuildOptions] = options;
  self.ast = ast;
  return self;
}

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/Struct.js
var lambda = (f) => f;

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/internal/schemaError.js
var SchemaErrorTypeId = "~effect/Schema/SchemaError";
function isSchemaError(u) {
  return hasProperty(u, SchemaErrorTypeId) && u[SchemaErrorTypeId] === SchemaErrorTypeId;
}

// ../../node_modules/.pnpm/effect@4.1.0/node_modules/effect/dist/Schema.js
var TypeId9 = TypeId8;
function declareConstructor() {
  return (typeParameters, run, annotations) => {
    return make7(new Declaration(typeParameters.map(getAST), (typeParameters) => run(typeParameters.map((ast) => make7(ast))), annotations));
  };
}
function declare(is, annotations) {
  return declareConstructor()([], () => (input, ast, options) => is(input) ? succeed5(input) : fail5(new InvalidType(ast, input, options)), annotations);
}
function annotate2(annotations) {
  return (self) => self.annotate(annotations);
}
class SchemaError extends (/* @__PURE__ */ TaggedError2("SchemaError")) {
  [SchemaErrorTypeId] = SchemaErrorTypeId;
  constructor(issue) {
    const stackTraceLimit = getStackTraceLimit();
    setStackTraceLimit(0);
    try {
      super({
        issue
      });
    } finally {
      setStackTraceLimit(stackTraceLimit);
    }
  }
  get message() {
    return defaultFormatter(this.issue);
  }
  toJSON() {
    return {
      _tag: this._tag,
      message: this.message
    };
  }
  [NodeInspectSymbol]() {
    return this.toJSON();
  }
  toString() {
    return `SchemaError(${this.message})`;
  }
}
function isSchemaError2(u) {
  return isSchemaError(u);
}
function fromIssueEffect(self) {
  if (effectIsExit(self)) {
    return fromIssueExit(self);
  }
  return catchCause2(self, (cause) => failCauseSync2(() => map3(cause, (issue) => new SchemaError(issue))));
}
function fromIssueExit(exit) {
  return isSuccess3(exit) ? exit : failCause2(map3(exit.cause, (issue) => new SchemaError(issue)));
}
function getSchemaErrorOrThrow(cause, message) {
  let schemaError;
  for (const reason of cause.reasons) {
    if (!isFailReason2(reason) || !isSchemaError2(reason.error)) {
      throw new globalThis.Error(message, {
        cause
      });
    }
    schemaError ??= reason.error;
  }
  if (schemaError === undefined) {
    throw new globalThis.Error(message, {
      cause
    });
  }
  return schemaError;
}
function runSchemaErrorSync(self) {
  const exit = runSyncExit2(self);
  if (isSuccess3(exit)) {
    return exit.value;
  }
  throw getSchemaErrorOrThrow(exit.cause, "Sync adapter can only throw schema errors");
}
function decodeUnknownEffect2(schema, options) {
  const parser = decodeUnknownEffect(schema, options);
  return (input, options) => {
    return fromIssueEffect(parser(input, options));
  };
}
function decodeUnknownSync(schema, options) {
  const parser = decodeUnknownEffect2(schema, options);
  return (input, options) => {
    return runSchemaErrorSync(parser(input, options));
  };
}
var make7 = make6;
function isSchema(u) {
  return hasProperty(u, TypeId9) && u[TypeId9] === TypeId9;
}
var optionalKey2 = /* @__PURE__ */ lambda((schema) => make7(optionalKey(schema.ast), {
  schema
}));
var optional2 = /* @__PURE__ */ lambda((self) => {
  const schema = UndefinedOr(self);
  return make7(optional(self.ast), {
    schema
  });
});
var toType2 = /* @__PURE__ */ lambda((schema) => make7(toType(schema.ast), {
  schema
}));
function Literal2(literal) {
  const out = make7(new Literal(literal), {
    literal,
    transform(to) {
      return out.pipe(decodeTo2(Literal2(to), {
        decode: transform(() => to),
        encode: transform(() => literal)
      }));
    }
  });
  return out;
}
function templateLiteralParts(parts) {
  return parts.map((part) => isSchema(part) ? part.ast : new Literal(part));
}
function TemplateLiteral2(parts) {
  return make7(new TemplateLiteral(templateLiteralParts(parts)), {
    parts
  });
}
var Any2 = /* @__PURE__ */ make7(any);
var Unknown2 = /* @__PURE__ */ make7(unknown);
var Undefined2 = /* @__PURE__ */ make7(undefined_2);
var String4 = /* @__PURE__ */ make7(string2);
var Number5 = /* @__PURE__ */ make7(number2);
var Boolean3 = /* @__PURE__ */ make7(boolean);
function makeStruct(ast, fields) {
  return make7(ast, {
    fields,
    mapFields(f, options) {
      const fields = f(this.fields);
      return makeStruct(struct(fields, options?.unsafePreserveChecks ? this.ast.checks : undefined), fields);
    }
  });
}
function Struct(fields) {
  return makeStruct(struct(fields, undefined), fields);
}
function Record(key, value) {
  return make7(record(key.ast, value.ast), {
    key,
    value
  });
}
function StructWithRest(schema, records) {
  return make7(structWithRest(schema.ast, records.map(getAST)), {
    schema,
    records
  });
}
var ArraySchema = /* @__PURE__ */ lambda((schema) => make7(new Arrays(false, [], [schema.ast]), {
  value: schema
}));
function makeUnion(ast, members) {
  return make7(ast, {
    members,
    mapMembers(f, options) {
      const members = f(this.members);
      return makeUnion(union(members, this.ast.options, options?.unsafePreserveChecks ? this.ast.checks : undefined), members);
    }
  });
}
function Union2(members, options) {
  return makeUnion(union(members, options, undefined), members);
}
function Literals(literals) {
  const members = literals.map(Literal2);
  return make7(union(members, undefined, undefined), {
    literals,
    members,
    mapMembers(f) {
      return Union2(f(this.members));
    },
    pick(literals) {
      return Literals(literals);
    },
    transform(to) {
      return Union2(members.map((member, index) => member.transform(to[index])));
    }
  });
}
var UndefinedOr = /* @__PURE__ */ lambda((self) => Union2([self, Undefined2]));
function brand(identifier) {
  return (schema) => make7(schema.ast, {
    schema,
    identifier
  });
}
function decodeTo2(to, transformation) {
  return (from) => {
    return make7(decodeTo(from.ast, to.ast, transformation ? makeTransformation(transformation) : passthrough2()), {
      from,
      to
    });
  };
}
function linkDecoding() {
  return (to, decode) => link()(to, {
    decode,
    encode: forbiddenEncoding
  });
}
function instanceOf(constructor, annotations) {
  return declare((u) => u instanceof constructor, annotations);
}
function link() {
  return (encodeTo, transformation) => {
    return new Link(encodeTo.ast, makeTransformation(transformation));
  };
}
var makeFilter2 = makeFilter;
function isPattern2(regExp, annotations) {
  const source = regExp.source;
  const flags = regExp.flags;
  const canExport = /^[dg]*uy?$/.test(flags);
  const runtimeRegExp = flags === "" ? `new globalThis.RegExp(${format(source)})` : `new globalThis.RegExp(${format(source)}, ${format(flags)})`;
  return isPattern(regExp, {
    toJsonSchema: () => canExport ? {
      pattern: flags.endsWith("y") ? `^(?:${source})` : source
    } : [{}, true],
    toCode: () => ({
      runtime: `Schema.isPattern(${runtimeRegExp})`
    }),
    ...annotations
  });
}
function isBase64(annotations) {
  const pattern = "^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$";
  const regExp = /^[0-9a-zA-Z+/]*={0,2}$/;
  return makeFilter2((s) => s.length % 4 === 0 && regExp.test(s), {
    expected: "a base64 encoded string",
    representation: {
      id: "effect/schema/isBase64",
      payload: null
    },
    toJsonSchema: () => ({
      pattern
    }),
    arbitraryConstraint: {
      patterns: [{
        source: pattern,
        flags: ""
      }]
    },
    toCode: () => ({
      runtime: "Schema.isBase64()"
    }),
    ...annotations
  });
}
var Finite = /* @__PURE__ */ make7(finite);
function makeIsGreaterThan(options) {
  const gt = isGreaterThan(options.order);
  const formatter = options.formatter ?? format;
  return (exclusiveMinimum, annotations) => {
    return makeFilter2((input) => gt(input, exclusiveMinimum), {
      expected: `a value greater than ${formatter(exclusiveMinimum)}`,
      arbitraryConstraint: {
        order: options.order,
        minimum: exclusiveMinimum,
        exclusiveMinimum: true
      },
      ...options.annotate?.(exclusiveMinimum),
      ...annotations
    });
  };
}
function makeIsGreaterThanOrEqualTo(options) {
  const gte = isGreaterThanOrEqualTo(options.order);
  const formatter = options.formatter ?? format;
  return (minimum, annotations) => {
    return makeFilter2((input) => gte(input, minimum), {
      expected: `a value greater than or equal to ${formatter(minimum)}`,
      arbitraryConstraint: {
        order: options.order,
        minimum
      },
      ...options.annotate?.(minimum),
      ...annotations
    });
  };
}
function makeIsLessThanOrEqualTo(options) {
  const lte = isLessThanOrEqualTo(options.order);
  const formatter = options.formatter ?? format;
  return (maximum, annotations) => {
    return makeFilter2((input) => lte(input, maximum), {
      expected: `a value less than or equal to ${formatter(maximum)}`,
      arbitraryConstraint: {
        order: options.order,
        maximum
      },
      ...options.annotate?.(maximum),
      ...annotations
    });
  };
}
function makeIsBetween(deriveOptions) {
  const greaterThanOrEqualTo = isGreaterThanOrEqualTo(deriveOptions.order);
  const greaterThan = isGreaterThan(deriveOptions.order);
  const lessThanOrEqualTo = isLessThanOrEqualTo(deriveOptions.order);
  const lessThan = isLessThan(deriveOptions.order);
  const formatter = deriveOptions.formatter ?? format;
  return (options, annotations) => {
    const gte = options.exclusiveMinimum ? greaterThan : greaterThanOrEqualTo;
    const lte = options.exclusiveMaximum ? lessThan : lessThanOrEqualTo;
    return makeFilter2((input) => gte(input, options.minimum) && lte(input, options.maximum), {
      expected: `a value between ${formatter(options.minimum)}${options.exclusiveMinimum ? " (excluded)" : ""} and ${formatter(options.maximum)}${options.exclusiveMaximum ? " (excluded)" : ""}`,
      arbitraryConstraint: {
        order: deriveOptions.order,
        minimum: options.minimum,
        maximum: options.maximum,
        ...options.exclusiveMinimum && {
          exclusiveMinimum: true
        },
        ...options.exclusiveMaximum && {
          exclusiveMaximum: true
        }
      },
      ...deriveOptions.annotate?.(options),
      ...annotations
    });
  };
}
function encodeNumberPayload(number) {
  if (!globalThis.Number.isFinite(number)) {
    throw new globalThis.RangeError(`Expected a finite number, got ${format(number)}`);
  }
  return number;
}
var isGreaterThan3 = /* @__PURE__ */ makeIsGreaterThan({
  order: Number2,
  annotate: (exclusiveMinimum) => ({
    representation: {
      id: "effect/schema/isGreaterThan",
      payload: {
        exclusiveMinimum: encodeNumberPayload(exclusiveMinimum)
      }
    },
    toJsonSchema: () => ({
      exclusiveMinimum
    }),
    toCode: () => ({
      runtime: `Schema.isGreaterThan(${format(exclusiveMinimum)})`
    })
  })
});
var isGreaterThanOrEqualTo3 = /* @__PURE__ */ makeIsGreaterThanOrEqualTo({
  order: Number2,
  annotate: (minimum) => ({
    representation: {
      id: "effect/schema/isGreaterThanOrEqualTo",
      payload: {
        minimum: encodeNumberPayload(minimum)
      }
    },
    toJsonSchema: () => ({
      minimum
    }),
    toCode: () => ({
      runtime: `Schema.isGreaterThanOrEqualTo(${format(minimum)})`
    })
  })
});
var isLessThanOrEqualTo3 = /* @__PURE__ */ makeIsLessThanOrEqualTo({
  order: Number2,
  annotate: (maximum) => ({
    representation: {
      id: "effect/schema/isLessThanOrEqualTo",
      payload: {
        maximum: encodeNumberPayload(maximum)
      }
    },
    toJsonSchema: () => ({
      maximum
    }),
    toCode: () => ({
      runtime: `Schema.isLessThanOrEqualTo(${format(maximum)})`
    })
  })
});
var isBetween = /* @__PURE__ */ makeIsBetween({
  order: Number2,
  annotate: (options) => {
    const exclusiveMinimum = options.exclusiveMinimum ? true : undefined;
    const exclusiveMaximum = options.exclusiveMaximum ? true : undefined;
    const payload = {
      minimum: encodeNumberPayload(options.minimum),
      maximum: encodeNumberPayload(options.maximum),
      ...exclusiveMinimum && {
        exclusiveMinimum
      },
      ...exclusiveMaximum && {
        exclusiveMaximum
      }
    };
    return {
      representation: {
        id: "effect/schema/isBetween",
        payload
      },
      toJsonSchema: () => ({
        [exclusiveMinimum ? "exclusiveMinimum" : "minimum"]: options.minimum,
        [exclusiveMaximum ? "exclusiveMaximum" : "maximum"]: options.maximum
      }),
      toCode: () => ({
        runtime: `Schema.isBetween({ minimum: ${format(options.minimum)}, maximum: ${format(options.maximum)}, exclusiveMinimum: ${format(exclusiveMinimum)}, exclusiveMaximum: ${format(exclusiveMaximum)} })`
      })
    };
  }
});
function isInt(annotations) {
  return makeFilter2((n) => globalThis.Number.isSafeInteger(n), {
    expected: "an integer",
    representation: {
      id: "effect/schema/isInt",
      payload: null
    },
    toJsonSchema: () => ({
      type: "integer",
      minimum: globalThis.Number.MIN_SAFE_INTEGER,
      maximum: globalThis.Number.MAX_SAFE_INTEGER
    }),
    toCode: () => ({
      runtime: "Schema.isInt()"
    }),
    arbitraryConstraint: {
      number: "integer"
    },
    ...annotations
  });
}
var Int = /* @__PURE__ */ Number5.check(/* @__PURE__ */ isInt());
function isMinLength(minLength, annotations) {
  minLength = normalizeCardinality(minLength);
  return makeIsMinLength(minLength, Math.ceil(minLength / 2), annotations);
}
function makeIsMinLength(minLength, minCodePoints, annotations) {
  return makeFilter2((input) => input.length >= minLength, {
    expected: `a value with a length of at least ${minLength}`,
    representation: {
      id: "effect/schema/isMinLength",
      payload: {
        minLength
      }
    },
    toJsonSchema: ({
      type
    }) => type === "string" ? minLength <= 1 ? {
      minLength: minCodePoints
    } : [{
      minLength: minCodePoints
    }, true] : type === "array" ? {
      minItems: minLength
    } : type === undefined ? [{
      minLength: minCodePoints,
      minItems: minLength
    }, true] : [{}, true],
    toCode: () => ({
      runtime: `Schema.isMinLength(${minLength})`
    }),
    [STRUCTURAL_ANNOTATION_KEY]: true,
    arbitraryConstraint: {
      minLength
    },
    ...annotations
  });
}
function isNonEmpty(annotations) {
  return makeIsMinLength(1, 1, annotations);
}
function normalizeCardinality(value) {
  if (!globalThis.Number.isFinite(value)) {
    throw new globalThis.RangeError(`Expected a finite number, got ${value}`);
  }
  return Math.max(0, Math.floor(value));
}
var NonEmptyString = /* @__PURE__ */ String4.check(/* @__PURE__ */ isNonEmpty());
var RegExp2 = /* @__PURE__ */ instanceOf(globalThis.RegExp, {
  representation: {
    id: "effect/schema/RegExp",
    payload: null
  },
  toCode: () => ({
    runtime: `Schema.RegExp`,
    Type: `globalThis.RegExp`
  }),
  expected: "RegExp",
  toCodecJson: () => link()(Struct({
    source: String4,
    flags: String4
  }), transformEffect2({
    decode: (e, options) => try_2({
      try: () => new globalThis.RegExp(e.source, e.flags),
      catch: () => new InvalidValue({
        expected: "valid RegExp source and flags"
      }, e, options)
    }),
    encode: (regExp) => succeed5({
      source: regExp.source,
      flags: regExp.flags
    })
  }))
});
var URLString = /* @__PURE__ */ String4.annotate({
  expected: "a string that will be decoded as a URL"
});
var URL2 = /* @__PURE__ */ instanceOf(globalThis.URL, {
  representation: {
    id: "effect/schema/URL",
    payload: null
  },
  toCode: () => ({
    runtime: `Schema.URL`,
    Type: `globalThis.URL`
  }),
  expected: "URL",
  toCodecJson: () => link()(URLString, urlFromString)
});
var File = /* @__PURE__ */ instanceOf(globalThis.File, {
  representation: {
    id: "effect/schema/File",
    payload: null
  },
  toCode: () => ({
    runtime: `Schema.File`,
    Type: `globalThis.File`
  }),
  expected: "File",
  toCodecJson: () => link()(Struct({
    data: String4.check(isBase64()),
    type: String4,
    name: String4,
    lastModified: Int
  }), transformEffect2({
    decode: (e, options) => match2(decode(e.data), {
      onFailure: () => fail5(new InvalidValue({
        expected: "a valid Base64 string"
      }, e.data, options)),
      onSuccess: (bytes) => {
        const buffer = new globalThis.Uint8Array(bytes);
        return succeed5(new globalThis.File([buffer], e.name, {
          type: e.type,
          lastModified: e.lastModified
        }));
      }
    }),
    encode: (file, options) => tryPromise2({
      try: async () => {
        const bytes = new globalThis.Uint8Array(await file.arrayBuffer());
        return {
          data: encode(bytes),
          type: file.type,
          name: file.name,
          lastModified: file.lastModified
        };
      },
      catch: () => new InvalidValue({
        expected: "a readable File"
      }, file, options)
    })
  }))
});
var URLSearchParams2 = /* @__PURE__ */ instanceOf(globalThis.URLSearchParams, {
  representation: {
    id: "effect/schema/URLSearchParams",
    payload: null
  },
  toCode: () => ({
    runtime: `Schema.URLSearchParams`,
    Type: `globalThis.URLSearchParams`
  }),
  expected: "URLSearchParams",
  toCodecJson: () => link()(String4.annotate({
    expected: "a query string that will be decoded as URLSearchParams"
  }), transform2({
    decode: (e) => new globalThis.URLSearchParams(e),
    encode: (params) => params.toString()
  }))
});
var Base64String = /* @__PURE__ */ String4.annotate({
  expected: "a base64 encoded string that will be decoded as Uint8Array",
  format: "byte",
  contentEncoding: "base64"
});
var Uint8Array2 = /* @__PURE__ */ instanceOf(globalThis.Uint8Array, {
  representation: {
    id: "effect/schema/Uint8Array",
    payload: null
  },
  toCode: () => ({
    runtime: `Schema.Uint8Array`,
    Type: `globalThis.Uint8Array`
  }),
  expected: "Uint8Array",
  toCodecJson: () => link()(Base64String, uint8ArrayFromBase64String)
});
var dateTimeUtcFromString = /* @__PURE__ */ transformEffect2({
  decode: (s, options) => {
    return match(make4(s), {
      onNone: () => fail5(new InvalidValue({
        expected: "a valid UTC DateTime string"
      }, s, options)),
      onSome: (result) => succeed5(toUtc2(result))
    });
  },
  encode: (utc) => succeed5(formatIso2(utc))
});
var arbitraryMinimumDateTimestamp = -8640000000000000;
var arbitraryMaximumDateTimestamp = 8640000000000000;
var arbitraryMinimumZonedDateTimeTimestamp = arbitraryMinimumDateTimestamp + 14 * 60 * 60 * 1000;
var arbitraryMaximumZonedDateTimeTimestamp = arbitraryMaximumDateTimestamp - 14 * 60 * 60 * 1000;
var arbitraryMinimumTimeZoneOffset = -12 * 60 * 60 * 1000;
var arbitraryMaximumTimeZoneOffset = 14 * 60 * 60 * 1000;
function dateTimeArbitraryBounds(constraint, domainMinimum, domainMaximum) {
  const minimum = Math.max(domainMinimum, constraint?.minimum === undefined ? domainMinimum : constraint.minimum.epochMilliseconds + (constraint.exclusiveMinimum === true ? 1 : 0));
  const maximum = Math.min(domainMaximum, constraint?.maximum === undefined ? domainMaximum : constraint.maximum.epochMilliseconds - (constraint.exclusiveMaximum === true ? 1 : 0));
  return minimum <= maximum ? [minimum, maximum] : [domainMinimum, domainMaximum];
}
function dateTimeArbitraryInteger(minimum, maximum) {
  return Int.check(isBetween({
    minimum,
    maximum
  }));
}
var DateTimeUtc = /* @__PURE__ */ declare((u) => isDateTime2(u) && isUtc2(u), {
  representation: {
    id: "effect/schema/DateTimeUtc",
    payload: null
  },
  toCode: () => ({
    runtime: `Schema.DateTimeUtc`,
    Type: `DateTime.Utc`,
    importDeclarations: [`import * as DateTime from "effect/DateTime"`]
  }),
  expected: "DateTime.Utc",
  toCodecArbitrary: ({
    constraint
  }) => {
    const [minimum, maximum] = dateTimeArbitraryBounds(constraint, arbitraryMinimumDateTimestamp, arbitraryMaximumDateTimestamp);
    return linkDecoding()(dateTimeArbitraryInteger(minimum, maximum), transform(makeUnsafe3));
  },
  toCodecJson: () => link()(String4, dateTimeUtcFromString),
  toFormatter: () => (utc) => utc.toString()
});
// ../tui-base/src/config/keybind.ts
var KeyStroke = Struct({
  name: String4,
  ctrl: optional2(Boolean3),
  shift: optional2(Boolean3),
  meta: optional2(Boolean3),
  super: optional2(Boolean3),
  hyper: optional2(Boolean3)
});
var BindingObject = StructWithRest(Struct({
  key: Union2([String4, KeyStroke]),
  event: optional2(Literals(["press", "release"])),
  preventDefault: optional2(Boolean3),
  fallthrough: optional2(Boolean3)
}), [Record(String4, Unknown2)]);
var BindingItem = Union2([String4, KeyStroke, BindingObject]);
var BindingValueSchema = Union2([
  Literal2(false),
  Literal2("none"),
  BindingItem,
  ArraySchema(BindingItem)
]).annotate({ identifier: "TuiKeybind.BindingValue" });
var LeaderDefault = "ctrl+x";
var keybind = (value, description) => ({ default: value, description });
var Definitions = {
  leader: keybind(LeaderDefault, "Leader key for keybind combinations"),
  "app.exit": keybind("ctrl+c,ctrl+d,<leader>q", "Exit the application"),
  "app.clear": keybind("ctrl+l", "Clear the screen in mini"),
  "app.debug": keybind("none", "Toggle debug panel"),
  "app.console": keybind("none", "Toggle console"),
  "app.scrap": keybind("none", "Open scrap screen"),
  "app.toggle.animations": keybind("none", "Toggle animations"),
  "app.toggle.file_context": keybind("none", "Toggle file context"),
  "app.toggle.diffwrap": keybind("none", "Toggle diff wrapping"),
  "app.toggle.paste_summary": keybind("none", "Toggle paste summary"),
  "command.palette.show": keybind("ctrl+p", "List available commands"),
  "help.show": keybind("none", "Open help dialog"),
  "docs.open": keybind("none", "Open documentation"),
  "opencode.settings": keybind("none", "Open settings"),
  "server.pair": keybind("none", "Pair device"),
  "service.restart": keybind("none", "Restart service"),
  "location.reload": keybind("none", "Reload configuration"),
  "diff.open": keybind("none", "Open diff viewer"),
  "diff.close": keybind("escape,q", "Close diff viewer"),
  "diff.down": keybind("j,down", "Move diff viewer down"),
  "diff.up": keybind("k,up", "Move diff viewer up"),
  "diff.page.down": keybind("pagedown,ctrl+f", "Page diff viewer down"),
  "diff.page.up": keybind("pageup,ctrl+b", "Page diff viewer up"),
  "diff.half_page.down": keybind("ctrl+d", "Scroll diff viewer down half a page"),
  "diff.half_page.up": keybind("ctrl+u", "Scroll diff viewer up half a page"),
  "diff.first": keybind("gg,home", "Go to the start of the diff"),
  "diff.last": keybind("shift+g,end", "Go to the end of the diff"),
  "diff.toggle": keybind("none", "Deprecated: file tree is mouse-controlled"),
  "diff.expand": keybind("none", "Deprecated: file tree is mouse-controlled"),
  "diff.expand_all": keybind("none", "Deprecated: file tree is mouse-controlled"),
  "diff.collapse": keybind("none", "Deprecated: file tree is mouse-controlled"),
  "diff.switch_focus": keybind("none", "Deprecated: keyboard navigation always controls the diff"),
  "diff.next_hunk": keybind("]", "Jump to next diff hunk"),
  "diff.previous_hunk": keybind("[", "Jump to previous diff hunk"),
  "diff.next_file": keybind("n,alt+down", "Jump to next diff file"),
  "diff.previous_file": keybind("p,alt+up", "Jump to previous diff file"),
  "diff.toggle_file_tree": keybind("b", "Toggle diff viewer file tree"),
  "diff.single_patch": keybind("s", "Toggle single patch view"),
  "diff.switch_source": keybind("d", "Switch diff viewer source"),
  "diff.toggle_view": keybind("v", "Toggle diff viewer split or unified view"),
  "diff.toggle_fullscreen": keybind("f", "Toggle diff viewer full screen"),
  "diff.mark_reviewed": keybind("m", "Toggle selected diff file reviewed"),
  "diff.help": keybind("?,shift+?,shift+/", "Show more diff viewer shortcuts"),
  "prompt.editor": keybind("<leader>e", "Open external editor"),
  "theme.switch": keybind("none", "List available themes"),
  "theme.switch_mode": keybind("none", "Switch between light and dark theme mode"),
  "theme.mode.lock": keybind("none", "Lock or unlock theme mode"),
  "session.sidebar.toggle": keybind("<leader>b", "Toggle sidebar"),
  "pane.focus.left": keybind("<leader>left", "Focus session pane"),
  "pane.focus.right": keybind("<leader>right", "Focus right pane"),
  "terminal.select": keybind("<leader>down", "Select terminal"),
  "terminal.toggle": keybind("<leader>t", "Toggle terminal pane"),
  "terminal.close": keybind("<leader>up", "Close terminal pane"),
  "session.toggle.scrollbar": keybind("none", "Toggle session scrollbar"),
  "opencode.status": keybind("<leader>s", "View status"),
  "opencode.debug": keybind("none", "View debug info"),
  "session.export": keybind("<leader>x", "Export session to editor"),
  "session.copy": keybind("none", "Copy session transcript"),
  "session.copy.id": keybind("none", "Copy session ID"),
  "session.move": keybind("none", "Manage workspaces"),
  "session.new": keybind("<leader>n", "Create a new session"),
  "session.list": keybind("<leader>l", "List all sessions"),
  "open.menu": keybind("ctrl+o", "Open recent sessions and projects"),
  "session.tab.next": keybind("ctrl+tab,alt+down", "Switch to next open session tab"),
  "session.tab.previous": keybind("ctrl+shift+tab,alt+up", "Switch to previous open session tab"),
  "session.tab.history.back": keybind("none", "Go back in session tab history"),
  "session.tab.history.forward": keybind("ctrl+i", "Go forward in session tab history"),
  "session.tab.next_unread": keybind("alt+shift+down", "Switch to next unread session tab"),
  "session.tab.previous_unread": keybind("alt+shift+up", "Switch to previous unread session tab"),
  "session.tab.close": keybind("<leader>w", "Close current session tab"),
  "session.tab.reopen": keybind("ctrl+shift+t", "Reopen last closed session tab"),
  "session.timeline": keybind("<leader>g", "Show session timeline"),
  "session.fork": keybind("none", "Fork session from message"),
  "session.rename": keybind("ctrl+r", "Rename session"),
  "session.delete": keybind("ctrl+d", "Delete session"),
  "session.share": keybind("none", "Deprecated: session sharing was removed"),
  "session.unshare": keybind("none", "Deprecated: session sharing was removed"),
  "session.interrupt": keybind("escape", "Interrupt current session"),
  "session.background": keybind("ctrl+b", "Background blocking session tools"),
  "session.compact": keybind("<leader>c", "Compact the session"),
  "session.aside": keybind("none", "Ask a side question"),
  "session.cd": keybind("none", "Change working directory"),
  "session.queued_prompts": keybind("<leader>q", "Manage queued prompts"),
  "queued_prompt.undo": keybind("ctrl+u", "Undo queued prompt"),
  "queued_prompt.delete": keybind("ctrl+d", "Delete queued prompt"),
  "session.toggle.exploration_grouping": keybind("none", "Toggle related tool call grouping"),
  "session.verbosity.cycle": keybind("none", "Cycle transcript verbosity"),
  "session.child.first": keybind("down", "Toggle subagent picker"),
  "session.child.next": keybind("right", "Go to next child session"),
  "session.child.previous": keybind("left", "Go to previous child session"),
  "session.parent": keybind("up", "Go to parent session"),
  "session.pin.toggle": keybind("ctrl+f", "Pin or unpin session in the session list"),
  "session.quick_switch.1": keybind("<leader>1", "Switch to session in quick slot 1"),
  "session.quick_switch.2": keybind("<leader>2", "Switch to session in quick slot 2"),
  "session.quick_switch.3": keybind("<leader>3", "Switch to session in quick slot 3"),
  "session.quick_switch.4": keybind("<leader>4", "Switch to session in quick slot 4"),
  "session.quick_switch.5": keybind("<leader>5", "Switch to session in quick slot 5"),
  "session.quick_switch.6": keybind("<leader>6", "Switch to session in quick slot 6"),
  "session.quick_switch.7": keybind("<leader>7", "Switch to session in quick slot 7"),
  "session.quick_switch.8": keybind("<leader>8", "Switch to session in quick slot 8"),
  "session.quick_switch.9": keybind("<leader>9", "Switch to session in quick slot 9"),
  "session.tab.select.1": keybind("<leader>1,ctrl+1", "Switch to session tab 1"),
  "session.tab.select.2": keybind("<leader>2,ctrl+2", "Switch to session tab 2"),
  "session.tab.select.3": keybind("<leader>3,ctrl+3", "Switch to session tab 3"),
  "session.tab.select.4": keybind("<leader>4,ctrl+4", "Switch to session tab 4"),
  "session.tab.select.5": keybind("<leader>5,ctrl+5", "Switch to session tab 5"),
  "session.tab.select.6": keybind("<leader>6,ctrl+6", "Switch to session tab 6"),
  "session.tab.select.7": keybind("<leader>7,ctrl+7", "Switch to session tab 7"),
  "session.tab.select.8": keybind("<leader>8,ctrl+8", "Switch to session tab 8"),
  "session.tab.select.9": keybind("<leader>9,ctrl+9", "Switch to session tab 9"),
  "session.tab.select.10": keybind("<leader>0,ctrl+0", "Switch to session tab 10"),
  "stash.delete": keybind("ctrl+d", "Delete stash entry"),
  "model.dialog.provider": keybind("ctrl+a", "Open provider list from model dialog"),
  "model.dialog.favorite": keybind("ctrl+f", "Toggle model favorite status"),
  "model.dialog.usage": keybind("ctrl+u", "Open usage limits from model dialog"),
  "model.list": keybind("<leader>m", "List available models"),
  "model.cycle_recent": keybind("f2", "Next recently used model"),
  "model.cycle_recent_reverse": keybind("shift+f2", "Previous recently used model"),
  "model.cycle_favorite": keybind("none", "Next favorite model"),
  "model.cycle_favorite_reverse": keybind("none", "Previous favorite model"),
  "mcp.list": keybind("none", "List MCP servers"),
  "usage.show": keybind("none", "View usage limits"),
  "provider.connect": keybind("none", "Connect integration"),
  "agent.list": keybind("<leader>a", "List agents"),
  "agent.cycle": keybind("shift+tab", "Next agent"),
  "agent.cycle.reverse": keybind("none", "Previous agent"),
  "variant.cycle": keybind("ctrl+t", "Cycle model variants"),
  "variant.list": keybind("none", "List model variants"),
  "session.page.up": keybind("pageup,ctrl+alt+b", "Scroll messages up by one page"),
  "session.page.down": keybind("pagedown,ctrl+alt+f", "Scroll messages down by one page"),
  "session.line.up": keybind("ctrl+alt+y", "Scroll messages up by one line"),
  "session.line.down": keybind("ctrl+alt+e", "Scroll messages down by one line"),
  "session.half.page.up": keybind("ctrl+alt+u", "Scroll messages up by half page"),
  "session.half.page.down": keybind("ctrl+alt+d", "Scroll messages down by half page"),
  "session.first": keybind("ctrl+g,home,alt+home", "Navigate to first message"),
  "session.last": keybind("ctrl+alt+g,end", "Navigate to last message"),
  "session.message.next": keybind("none", "Navigate to next message"),
  "session.message.previous": keybind("none", "Navigate to previous message"),
  "session.message.user.next": keybind("none", "Navigate to next user message"),
  "session.message.user.previous": keybind("none", "Navigate to previous user message"),
  "session.messages_last_user": keybind("alt+end", "Navigate to last user message"),
  "messages.copy": keybind("<leader>y", "Copy message"),
  "session.undo": keybind("<leader>u", "Undo message"),
  "session.redo": keybind("<leader>r", "Redo message"),
  "session.toggle.thinking": keybind("none", "Toggle thinking blocks visibility"),
  "prompt.submit": keybind("none", "Submit prompt"),
  "prompt.queue": keybind("<leader>return", "Queue prompt"),
  "prompt.editor_context.clear": keybind("none", "Clear editor context"),
  "prompt.images.view": keybind("<leader>i", "View image attachments"),
  "prompt.skills": keybind("none", "Open skill selector"),
  "prompt.stash": keybind("none", "Stash prompt"),
  "prompt.stash.pop": keybind("none", "Pop stashed prompt"),
  "prompt.stash.list": keybind("none", "List stashed prompts"),
  "prompt.clear": keybind("ctrl+c", "Clear input field"),
  "prompt.paste": keybind({ key: "ctrl+v", preventDefault: false }, "Paste from clipboard"),
  "input.submit": keybind("return", "Submit input"),
  "input.newline": keybind("shift+return,ctrl+return,alt+return,ctrl+j", "Insert newline in input"),
  "input.move.left": keybind("left,ctrl+b", "Move cursor left in input"),
  "input.move.right": keybind("right,ctrl+f", "Move cursor right in input"),
  "input.move.up": keybind("up", "Move cursor up in input"),
  "input.move.down": keybind("down", "Move cursor down in input"),
  "input.select.left": keybind("shift+left", "Select left in input"),
  "input.select.right": keybind("shift+right", "Select right in input"),
  "input.select.up": keybind("shift+up", "Select up in input"),
  "input.select.down": keybind("shift+down", "Select down in input"),
  "input.line.home": keybind("ctrl+a", "Move to start of line in input"),
  "input.line.end": keybind("ctrl+e", "Move to end of line in input"),
  "input.select.line.home": keybind("ctrl+shift+a", "Select to start of line in input"),
  "input.select.line.end": keybind("ctrl+shift+e", "Select to end of line in input"),
  "input.visual.line.home": keybind("alt+a", "Move to start of visual line in input"),
  "input.visual.line.end": keybind("alt+e", "Move to end of visual line in input"),
  "input.select.visual.line.home": keybind("alt+shift+a", "Select to start of visual line in input"),
  "input.select.visual.line.end": keybind("alt+shift+e", "Select to end of visual line in input"),
  "input.buffer.home": keybind("none", "Move to start of buffer in input"),
  "input.buffer.end": keybind("none", "Move to end of buffer in input"),
  "input.select.buffer.home": keybind("shift+home", "Select to start of buffer in input"),
  "input.select.buffer.end": keybind("shift+end", "Select to end of buffer in input"),
  "input.delete.line": keybind("ctrl+shift+d", "Delete line in input"),
  "input.delete.to.line.end": keybind("ctrl+k", "Delete to end of line in input"),
  "input.delete.to.line.start": keybind("ctrl+u", "Delete to start of line in input"),
  "input.backspace": keybind("backspace,shift+backspace", "Backspace in input"),
  "input.delete": keybind("ctrl+d,delete,shift+delete", "Delete character in input"),
  "input.undo": keybind("ctrl+-,super+z", "Undo in input"),
  "input.redo": keybind("ctrl+.,super+shift+z", "Redo in input"),
  "input.word.forward": keybind("alt+f,alt+right,ctrl+right", "Move word forward in input"),
  "input.word.backward": keybind("alt+b,alt+left,ctrl+left", "Move word backward in input"),
  "input.select.word.forward": keybind("alt+shift+f,alt+shift+right", "Select word forward in input"),
  "input.select.word.backward": keybind("alt+shift+b,alt+shift+left", "Select word backward in input"),
  "input.delete.word.forward": keybind("alt+d,alt+delete,ctrl+delete", "Delete word forward in input"),
  "input.delete.word.backward": keybind("ctrl+w,ctrl+backspace,alt+backspace", "Delete word backward in input"),
  "input.select.all": keybind("super+a", "Select all in input"),
  "prompt.history.previous": keybind("up", "Previous history item"),
  "prompt.history.next": keybind("down", "Next history item"),
  "composer.subagent.up": keybind("up", "Previous subagent"),
  "composer.subagent.down": keybind("down", "Next subagent"),
  "composer.subagent.select": keybind("return", "Navigate to subagent"),
  "composer.subagent.interrupt": keybind("ctrl+d", "Interrupt subagent"),
  "composer.shell.up": keybind("up", "Previous shell"),
  "composer.shell.down": keybind("down", "Next shell"),
  "composer.shell.select": keybind("return", "View shell output"),
  "composer.shell.kill": keybind("ctrl+d", "Kill shell command"),
  "composer.terminal.up": keybind("up,k", "Previous terminal"),
  "composer.terminal.down": keybind("down,j", "Next terminal"),
  "composer.terminal.select": keybind("return", "Select terminal"),
  "dialog.select.prev": keybind("up,ctrl+p", "Move to previous dialog item"),
  "dialog.select.next": keybind("down,ctrl+n", "Move to next dialog item"),
  "dialog.select.page_up": keybind("pageup", "Move up one page in dialog"),
  "dialog.select.page_down": keybind("pagedown", "Move down one page in dialog"),
  "dialog.select.home": keybind("home", "Move to first dialog item"),
  "dialog.select.end": keybind("end", "Move to last dialog item"),
  "dialog.select.submit": keybind("return", "Submit selected dialog item"),
  "dialog.prompt.submit": keybind("return", "Submit dialog prompt"),
  "dialog.integration.rename": keybind("ctrl+r", "Rename integration account"),
  "dialog.integration.delete": keybind("ctrl+d", "Delete integration account"),
  "dialog.integration.copy": keybind("tab", "Copy authorization link"),
  "dialog.worktree.generate": keybind("tab", "Generate worktree name"),
  "dialog.move_session.new": keybind("ctrl+a", "New worktree"),
  "dialog.move_session.move": keybind("ctrl+m", "Move session to worktree"),
  "dialog.move_session.delete": keybind("ctrl+d", "Delete worktree"),
  "dialog.move_session.refresh": keybind("ctrl+r", "Refresh worktrees"),
  "prompt.autocomplete.prev": keybind("up,ctrl+p", "Move to previous autocomplete item"),
  "prompt.autocomplete.next": keybind("down,ctrl+n", "Move to next autocomplete item"),
  "prompt.autocomplete.hide": keybind("escape", "Hide autocomplete"),
  "prompt.autocomplete.select": keybind("return", "Select autocomplete item"),
  "prompt.autocomplete.complete": keybind("tab", "Complete autocomplete item"),
  "permission.prompt.fullscreen": keybind("ctrl+f", "Toggle permission prompt fullscreen"),
  "plugins.toggle": keybind("return", "Toggle plugin"),
  "dialog.mcp.toggle": keybind("space", "Toggle MCP server"),
  "dialog.plugins.error": keybind("space", "View plugin error"),
  "dialog.plugins.update": keybind("ctrl+u", "Update plugin from plugin dialog"),
  "dialog.plugins.check": keybind("ctrl+r", "Check for plugin updates from plugin dialog"),
  "terminal.suspend": keybind("ctrl+z", "Suspend terminal"),
  "terminal.title.toggle": keybind("none", "Toggle terminal title"),
  "plugins.list": keybind("none", "Open plugin manager dialog"),
  "which-key.toggle": keybind("ctrl+alt+k", "Toggle which-key panel"),
  "which-key.layout.toggle": keybind("ctrl+alt+shift+k", "Switch which-key layout"),
  "which-key.pending.toggle": keybind("ctrl+alt+shift+p", "Toggle which-key pending preview"),
  "which-key.group.previous": keybind("ctrl+alt+left,ctrl+alt+[", "Previous which-key group"),
  "which-key.group.next": keybind("ctrl+alt+right,ctrl+alt+]", "Next which-key group"),
  "which-key.scroll.up": keybind("ctrl+alt+up,ctrl+alt+p", "Scroll which-key up"),
  "which-key.scroll.down": keybind("ctrl+alt+down,ctrl+alt+n", "Scroll which-key down"),
  "which-key.page.up": keybind("ctrl+alt+pageup", "Page which-key up"),
  "which-key.page.down": keybind("ctrl+alt+pagedown", "Page which-key down"),
  "which-key.home": keybind("ctrl+alt+home", "Jump to first which-key binding"),
  "which-key.end": keybind("ctrl+alt+end", "Jump to last which-key binding")
};
var KeybindNames = new Set(Object.keys(Definitions));
var KeybindOverrides = Struct(Object.fromEntries(Object.entries(Definitions).map(([name, item]) => [
  name,
  optional2(BindingValueSchema).annotate({ description: item.description })
]))).annotate({ description: "TUI keybinding overrides" });
var Descriptions = Object.fromEntries(Object.entries(Definitions).map(([name, item]) => [name, item.description]));
function toBindingConfig(keybinds) {
  return Object.fromEntries(Object.entries(keybinds));
}
var decodeBindingValue = decodeUnknownSync(BindingValueSchema);
function defaultValue(name) {
  return Definitions[name].default;
}
function parse(keybinds) {
  const invalid = unknownKeys(keybinds);
  if (invalid.length)
    throw new Error(`Unrecognized keybind${invalid.length === 1 ? "" : "s"}: ${invalid.join(", ")}`);
  return Object.fromEntries(Object.entries(Definitions).map(([name, item]) => [
    name,
    decodeBindingValue(keybinds[name] ?? item.default)
  ]));
}
function unknownKeys(input) {
  return Object.keys(input).filter((key) => !KeybindNames.has(key));
}
function bindingDefaults() {
  return ({ command, binding }) => {
    if (binding.desc !== undefined)
      return;
    return { desc: Descriptions[command] };
  };
}

// ../tui-base/src/routes/session/composer-keybinds.ts
var MODIFIERS = {
  ctrl: "ctrl",
  shift: "shift",
  alt: "meta",
  meta: "meta",
  option: "meta",
  super: "super"
};
function parseStroke(spec) {
  const parts = spec.trim().toLowerCase().split("+");
  const name = parts.pop();
  if (!name || name.includes("<"))
    return;
  const stroke = { name };
  for (const part of parts) {
    const flag = MODIFIERS[part];
    if (!flag)
      return;
    stroke[flag] = true;
  }
  return stroke;
}
function strokesOf(value) {
  if (value === false || value === "none")
    return [];
  const items = Array.isArray(value) ? value : [value];
  const out = [];
  for (const item of items) {
    if (typeof item === "string") {
      for (const spec of item.split(",")) {
        const stroke = parseStroke(spec);
        if (stroke)
          out.push(stroke);
      }
      continue;
    }
    const key = "key" in item ? item.key : item;
    if (typeof key === "string") {
      const stroke = parseStroke(key);
      if (stroke)
        out.push(stroke);
      continue;
    }
    const { name, ctrl, shift, meta, super: sup } = key;
    out.push({ name, ...ctrl && { ctrl }, ...shift && { shift }, ...meta && { meta }, ...sup && { super: sup } });
  }
  return out;
}
function composerKeyBindings(config = {}) {
  const submit = config["input.submit"] ?? defaultValue("input.submit");
  const newline = config["input.newline"] ?? defaultValue("input.newline");
  const out = [];
  const push = (strokes, action) => {
    for (const stroke of strokes) {
      out.push({ ...stroke, action });
      if (stroke.name === "return")
        out.push({ ...stroke, name: "kpenter", action });
    }
  };
  push(strokesOf(submit), "submit");
  push(strokesOf(newline), "newline");
  return out;
}

// ../tui-base/src/context/theme.tsx
import { createComponent as _$createComponent4 } from "@opentui/solid";
import { CliRenderEvents } from "@opentui/core";
import { useRenderer } from "@opentui/solid";

// ../tui-base/src/vendor/theme/src/tui/schema.ts
var HueStep = Literals([100, 200, 300, 400, 500, 600, 700, 800, 900]);
var ActionVariant = Literals(["primary", "secondary", "destructive"]);
var ActionState = Literals(["disabled", "pressed", "focused", "selected", "hovered"]);
var SurfaceName = Literals(["dialog", "dialog.footer"]);
var FeedbackKind = Literals(["error", "warning", "success", "info"]);
var Mode = Literals(["light", "dark"]);
var HexColor = String4.check(isPattern2(/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i));
var ColorValue = Union2([
  HexColor,
  Literal2("transparent"),
  TemplateLiteral2(["$", NonEmptyString])
]);
var HueName = NonEmptyString;
var CategoricalDefinition = ArraySchema(HueName).check(isMinLength(1));
var HueColorValue = Union2([
  HexColor,
  String4.check(isPattern2(/^\$hue\..+\.(?:100|200|300|400|500|600|700|800|900)$/))
]);
var HueScaleDefinition = Record(HueStep, HexColor);
var HueValueDefinition = Union2([
  String4.check(isPattern2(/^\$hue\..+$/)),
  HueScaleDefinition
]);
var HueRecord = Record(HueName, HueValueDefinition);
var HueDefinition = HueRecord.check(makeFilter2((hues) => {
  const missing = ["accent", "interactive", "neutral"].filter((name) => hues[name] === undefined);
  return missing.length ? `Missing required semantic hues: ${missing.join(", ")}` : undefined;
}));
var StatefulColorDefinition = Struct({
  base: optional2(ColorValue),
  $hovered: optional2(ColorValue),
  $focused: optional2(ColorValue),
  $pressed: optional2(ColorValue),
  $selected: optional2(ColorValue),
  $disabled: optional2(ColorValue)
});
var ActionColorDefinition = Struct({
  primary: optional2(StatefulColorDefinition),
  secondary: optional2(StatefulColorDefinition),
  destructive: optional2(StatefulColorDefinition)
});
var TextFeedbackDefinition = Struct({
  base: optional2(ColorValue),
  muted: optional2(ColorValue)
});
var BackgroundFeedbackDefinition = Struct({
  base: optional2(ColorValue)
});
var TextDefinition = Struct({
  base: optional2(ColorValue),
  muted: optional2(ColorValue),
  faint: optional2(ColorValue),
  action: optional2(ActionColorDefinition),
  formfield: optional2(StatefulColorDefinition),
  feedback: optional2(Struct({
    error: optional2(TextFeedbackDefinition),
    warning: optional2(TextFeedbackDefinition),
    success: optional2(TextFeedbackDefinition),
    info: optional2(TextFeedbackDefinition)
  }))
});
var BackgroundDefinition = Struct({
  base: optional2(ColorValue),
  raised: optional2(Struct({
    base: optional2(ColorValue),
    high: optional2(ColorValue),
    max: optional2(ColorValue)
  })),
  action: optional2(ActionColorDefinition),
  formfield: optional2(StatefulColorDefinition),
  feedback: optional2(Struct({
    error: optional2(BackgroundFeedbackDefinition),
    warning: optional2(BackgroundFeedbackDefinition),
    success: optional2(BackgroundFeedbackDefinition),
    info: optional2(BackgroundFeedbackDefinition)
  }))
});
var SyntaxToken = Literals([
  "comment",
  "keyword",
  "function",
  "variable",
  "string",
  "number",
  "type",
  "operator",
  "punctuation"
]);
var SyntaxDefinition = Record(SyntaxToken, optionalKey2(HueColorValue));
var MarkdownToken = Literals([
  "text",
  "heading",
  "link",
  "linkText",
  "code",
  "blockQuote",
  "emphasis",
  "strong",
  "horizontalRule",
  "listItem",
  "listEnumeration",
  "image",
  "imageText",
  "codeBlock"
]);
var MarkdownDefinition = Record(MarkdownToken, optionalKey2(HueColorValue));
var DiffDefinition = Struct({
  text: optional2(Struct({
    added: optional2(ColorValue),
    removed: optional2(ColorValue),
    context: optional2(ColorValue),
    hunkHeader: optional2(ColorValue)
  })),
  background: optional2(Struct({
    added: optional2(ColorValue),
    removed: optional2(ColorValue),
    context: optional2(ColorValue)
  })),
  highlight: optional2(Struct({ added: optional2(ColorValue), removed: optional2(ColorValue) })),
  lineNumber: optional2(Struct({
    text: optional2(ColorValue),
    background: optional2(Struct({ added: optional2(ColorValue), removed: optional2(ColorValue) }))
  }))
});
var ThemeTokensDefinition = Struct({
  text: optional2(TextDefinition),
  background: optional2(BackgroundDefinition),
  border: optional2(Struct({ base: optional2(ColorValue) })),
  scrollbar: optional2(Struct({ base: optional2(ColorValue) })),
  diff: optional2(DiffDefinition),
  syntax: optional2(SyntaxDefinition),
  markdown: optional2(MarkdownDefinition)
});
var DialogTokensDefinition = Struct({
  ...ThemeTokensDefinition.fields,
  "@footer": optional2(ThemeTokensDefinition)
});
var CompleteStatefulColorDefinition = Struct({
  base: ColorValue,
  $hovered: optional2(ColorValue),
  $focused: optional2(ColorValue),
  $pressed: optional2(ColorValue),
  $selected: optional2(ColorValue),
  $disabled: optional2(ColorValue)
});
var CompleteActionColorDefinition = Struct({
  primary: CompleteStatefulColorDefinition,
  secondary: CompleteStatefulColorDefinition,
  destructive: CompleteStatefulColorDefinition
});
var CompleteTextFeedbackDefinition = Struct({ base: ColorValue, muted: optional2(ColorValue) });
var CompleteBackgroundFeedbackDefinition = Struct({ base: ColorValue });
var CompleteThemeTokensDefinition = Struct({
  text: Struct({
    base: ColorValue,
    muted: ColorValue,
    faint: optional2(ColorValue),
    action: CompleteActionColorDefinition,
    formfield: CompleteStatefulColorDefinition,
    feedback: Struct({
      error: CompleteTextFeedbackDefinition,
      warning: CompleteTextFeedbackDefinition,
      success: CompleteTextFeedbackDefinition,
      info: CompleteTextFeedbackDefinition
    })
  }),
  background: Struct({
    base: ColorValue,
    raised: Struct({ base: ColorValue, high: ColorValue, max: ColorValue }),
    action: CompleteActionColorDefinition,
    formfield: CompleteStatefulColorDefinition,
    feedback: Struct({
      error: CompleteBackgroundFeedbackDefinition,
      warning: CompleteBackgroundFeedbackDefinition,
      success: CompleteBackgroundFeedbackDefinition,
      info: CompleteBackgroundFeedbackDefinition
    })
  }),
  border: Struct({ base: ColorValue }),
  scrollbar: Struct({ base: ColorValue }),
  diff: Struct({
    text: Struct({ added: ColorValue, removed: ColorValue, context: ColorValue, hunkHeader: ColorValue }),
    background: Struct({ added: ColorValue, removed: ColorValue, context: ColorValue }),
    highlight: Struct({ added: ColorValue, removed: ColorValue }),
    lineNumber: Struct({
      text: ColorValue,
      background: Struct({ added: ColorValue, removed: ColorValue })
    })
  }),
  syntax: Record(SyntaxToken, HueColorValue),
  markdown: Record(MarkdownToken, HueColorValue)
});
var ThemeDefinitionFields = Struct({
  hue: HueDefinition,
  categorical: CategoricalDefinition,
  ...CompleteThemeTokensDefinition.fields,
  "@dialog": optional2(DialogTokensDefinition)
});
var ThemeDefinition = ThemeDefinitionFields;
var BaseThemeDefinition = Struct({
  categorical: CategoricalDefinition,
  ...CompleteThemeTokensDefinition.fields,
  "@dialog": optional2(DialogTokensDefinition)
});
var ModeDefinition = Struct({
  hue: HueDefinition,
  categorical: optional2(CategoricalDefinition),
  ...ThemeTokensDefinition.fields,
  "@dialog": optional2(DialogTokensDefinition)
});
var FileMetadata = {
  $schema: optional2(String4)
};
var ThemeDocument = Union2([
  Struct({
    ...FileMetadata,
    base: BaseThemeDefinition,
    light: ModeDefinition,
    dark: optional2(ModeDefinition)
  }),
  Struct({
    ...FileMetadata,
    base: BaseThemeDefinition,
    light: optional2(ModeDefinition),
    dark: ModeDefinition
  })
]);
// ../tui-base/src/vendor/theme/src/tui/color.ts
function clamp2(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function hue(value) {
  return (value % 360 + 360) % 360;
}
function linearToSrgb(value) {
  if (value <= 0.0031308)
    return value * 12.92;
  return 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
}
function srgbToLinear(value) {
  if (value <= 0.04045)
    return value / 12.92;
  return Math.pow((value + 0.055) / 1.055, 2.4);
}
function rgbToOklch(red, green, blue) {
  const linearRed = srgbToLinear(red);
  const linearGreen = srgbToLinear(green);
  const linearBlue = srgbToLinear(blue);
  const lRoot = Math.cbrt(0.4122214708 * linearRed + 0.5363325363 * linearGreen + 0.0514459929 * linearBlue);
  const mRoot = Math.cbrt(0.2119034982 * linearRed + 0.6806995451 * linearGreen + 0.1073969566 * linearBlue);
  const sRoot = Math.cbrt(0.0883024619 * linearRed + 0.2817188376 * linearGreen + 0.6299787005 * linearBlue);
  const lightness = 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot;
  const a = 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot;
  const b = 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot;
  const chroma = Math.sqrt(a * a + b * b);
  const angle = Math.atan2(b, a) * (180 / Math.PI);
  return { l: lightness, c: chroma, h: angle < 0 ? angle + 360 : angle };
}
function oklchToRgb(color) {
  const a = color.c * Math.cos(color.h * Math.PI / 180);
  const b = color.c * Math.sin(color.h * Math.PI / 180);
  const lRoot = color.l + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = color.l - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = color.l - 0.0894841775 * a - 1.291485548 * b;
  const l = lRoot * lRoot * lRoot;
  const m = mRoot * mRoot * mRoot;
  const s = sRoot * sRoot * sRoot;
  return {
    r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  };
}
function fitOklch(color) {
  const base = { l: clamp2(color.l, 0, 1), c: Math.max(0, color.c), h: hue(color.h) };
  const rgb = oklchToRgb(base);
  if (rgb.r >= 0 && rgb.r <= 1 && rgb.g >= 0 && rgb.g <= 1 && rgb.b >= 0 && rgb.b <= 1)
    return base;
  const fitted = Array.from({ length: 24 }).reduce((result, _, index) => {
    if (result)
      return result;
    const next = { ...base, c: base.c * Math.pow(0.9, index + 1) };
    const output = oklchToRgb(next);
    if (output.r >= 0 && output.r <= 1 && output.g >= 0 && output.g <= 1 && output.b >= 0 && output.b <= 1)
      return next;
  }, undefined);
  return fitted ?? { ...base, c: 0 };
}
function oklchToHex(color) {
  const rgb = oklchToRgb(fitOklch(color));
  const toHex = (value) => Math.round(clamp2(value, 0, 1) * 255).toString(16).padStart(2, "0");
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}
// ../tui-base/src/vendor/theme/src/tui/expand.ts
function expandTheme(definition) {
  return {
    ...definition,
    ...expandTokens(definition),
    ...definition["@dialog"] ? { "@dialog": expandDialog(definition["@dialog"]) } : {}
  };
}
function expandDialog(definition) {
  return {
    ...expandTokens(definition),
    ...definition["@footer"] ? { "@footer": expandTokens(definition["@footer"]) } : {}
  };
}
function expandTokens(definition) {
  return {
    ...definition,
    text: expandText(definition.text),
    background: expandBackground(definition.background)
  };
}
function mergeTheme(...values) {
  return values.reduce((result, value) => {
    if (!isRecord(value))
      return result;
    return Object.entries(value).reduce((next, [key, item]) => {
      if (item === undefined)
        return next;
      return {
        ...next,
        [key]: isRecord(item) ? mergeTheme(next[key], item) : item
      };
    }, result);
  }, {});
}
function expandText(definition) {
  if (!definition)
    return;
  return {
    ...definition,
    muted: definition.muted ?? (definition.base ? "$text.base" : undefined),
    faint: definition.faint ?? (definition.muted || definition.base ? "$text.muted" : undefined),
    action: expandActions(definition.action, "text.action"),
    formfield: expandFormfield(definition.formfield, "text.formfield"),
    feedback: definition.feedback ? Object.fromEntries(Object.entries(definition.feedback).map(([kind, feedback]) => {
      return [
        kind,
        {
          ...feedback,
          muted: feedback.muted ?? (feedback.base ? `$text.feedback.${kind}.base` : undefined)
        }
      ];
    })) : undefined
  };
}
function expandBackground(definition) {
  if (!definition)
    return;
  return {
    ...definition,
    action: expandActions(definition.action, "background.action"),
    formfield: expandFormfield(definition.formfield, "background.formfield")
  };
}
function expandFormfield(definition, path) {
  if (!definition?.base)
    return definition;
  return {
    ...definition,
    ...Object.fromEntries(ActionState.literals.map((state) => [`$${state}`, definition[`$${state}`] ?? `$${path}.base`]))
  };
}
function expandActions(definition, path) {
  if (!definition)
    return;
  return Object.fromEntries(Object.entries(definition).map(([variant, value]) => {
    if (!value?.base)
      return [variant, value];
    return [
      variant,
      {
        ...value,
        ...Object.fromEntries(ActionState.literals.map((state) => [`$${state}`, value[`$${state}`] ?? `$${path}.${variant}.base`]))
      }
    ];
  }));
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
// ../tui-base/src/vendor/theme/src/tui/v1-migrate.ts
import { RGBA } from "@opentui/core";
var chromaticHues = ["red", "orange", "yellow", "green", "cyan", "blue", "purple"];
var categoricalTokens = [
  "secondary",
  "accent",
  "success",
  "warning",
  "primary",
  "error",
  "info"
];
var minimumChroma = 0.03;
var lightThreshold = 0.6;
var hueReferences = {
  light: {
    red: "#fca5a5",
    orange: "#fdba74",
    yellow: "#fde047",
    green: "#86efac",
    cyan: "#67e8f9",
    blue: "#93c5fd",
    purple: "#d8b4fe"
  },
  dark: {
    red: "#b91c1c",
    orange: "#c2410c",
    yellow: "#a16207",
    green: "#15803d",
    cyan: "#0e7490",
    blue: "#1d4ed8",
    purple: "#7e22ce"
  }
};
var hueAngles = Object.fromEntries(Object.entries(hueReferences).map(([level, colors]) => [
  level,
  Object.fromEntries(Object.entries(colors).map(([name, color]) => [name, toOklch(RGBA.fromHex(color)).h]))
]));
function migrateV1(theme) {
  const light = resolveV1(theme, "light");
  const dark = resolveV1(theme, "dark");
  if (light.background.a > 0 && dark.background.a > 0 && light.background.equals(dark.background)) {
    const lightMode = detectMode(light);
    const darkMode = detectMode(dark);
    if (lightMode === darkMode) {
      const definition = migrateMode(lightMode === "light" ? light : dark, lightMode);
      if (lightMode === "light")
        return { base: base(definition), light: { hue: definition.hue } };
      return { base: base(definition), dark: { hue: definition.hue } };
    }
  }
  const lightDefinition = migrateMode(light, "light");
  const darkDefinition = migrateMode(dark, "dark");
  return {
    base: base(lightDefinition),
    light: { hue: lightDefinition.hue },
    dark: darkDefinition
  };
}
function base(definition) {
  const { hue: _, ...base } = definition;
  return base;
}
function detectMode(theme) {
  return luminance(theme.text) > luminance(theme.background) ? "dark" : "light";
}
function luminance(color) {
  return 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
}
function migrateMode(theme, mode) {
  const color = (key) => hex(theme[key]);
  const selected = hex(selectedForeground(theme, theme.primary));
  const destructive = hex(selectedForeground(theme, theme.error));
  const hues = inferHues(theme);
  const categorical = categoricalTokens.flatMap((token) => {
    const hue = hues.byToken[token];
    return hue ? [hue] : [];
  });
  const uniqueCategorical = categorical.filter((hue, index) => categorical.indexOf(hue) === index);
  const text = "$hue.neutral.200";
  const textMuted = "$hue.neutral.400";
  const primary = "$hue.interactive.200";
  const background = "$hue.neutral.800";
  const backgroundPanel = "$hue.neutral.700";
  const backgroundMenu = "$hue.neutral.600";
  const backgroundRaisedMax = "$hue.neutral.500";
  return referenceHues({
    hue: {
      gray: neutralScale(theme),
      ...Object.fromEntries(chromaticHues.flatMap((name) => {
        const match = hues.byHue[name];
        return match ? [[name, hueScale(match.color, mode)]] : [];
      })),
      accent: hues.byToken.accent ? `$hue.${hues.byToken.accent}` : "$hue.gray",
      interactive: hues.byToken.primary ? `$hue.${hues.byToken.primary}` : "$hue.gray",
      neutral: "$hue.gray"
    },
    categorical: uniqueCategorical.length ? uniqueCategorical : ["neutral"],
    text: {
      base: text,
      muted: textMuted,
      action: {
        primary: {
          base: "$text.base",
          $disabled: textMuted,
          $focused: selected,
          $selected: primary
        },
        secondary: { base: "$text.muted", $hovered: "$text.base" },
        destructive: { base: destructive, $disabled: textMuted }
      },
      formfield: {
        base: text,
        $hovered: primary,
        $focused: primary,
        $pressed: primary,
        $disabled: textMuted,
        $selected: primary
      },
      feedback: {
        error: { base: color("error") },
        warning: { base: color("warning") },
        success: { base: color("success") },
        info: { base: color("info") }
      }
    },
    background: {
      base: background,
      raised: {
        base: backgroundPanel,
        high: backgroundMenu,
        max: backgroundRaisedMax
      },
      action: {
        primary: { base: "transparent", $hovered: backgroundPanel, $focused: primary, $selected: "transparent" },
        secondary: { base: "transparent" },
        destructive: { base: color("error") }
      },
      formfield: {
        base: "$background.base"
      },
      feedback: {
        error: { base: "$background.base" },
        warning: { base: "$background.base" },
        success: { base: "$background.base" },
        info: { base: "$background.base" }
      }
    },
    border: { base: color("border") },
    scrollbar: { base: color("borderActive") },
    diff: {
      text: {
        added: color("diffAdded"),
        removed: color("diffRemoved"),
        context: color("diffContext"),
        hunkHeader: color("diffHunkHeader")
      },
      background: {
        added: color("diffAddedBg"),
        removed: color("diffRemovedBg"),
        context: color("diffContextBg")
      },
      highlight: { added: color("diffHighlightAdded"), removed: color("diffHighlightRemoved") },
      lineNumber: {
        text: color("diffLineNumber"),
        background: {
          added: color("diffAddedLineNumberBg"),
          removed: color("diffRemovedLineNumberBg")
        }
      }
    },
    syntax: {
      comment: color("syntaxComment"),
      keyword: color("syntaxKeyword"),
      function: color("syntaxFunction"),
      variable: color("syntaxVariable"),
      string: color("syntaxString"),
      number: color("syntaxNumber"),
      type: color("syntaxType"),
      operator: color("syntaxOperator"),
      punctuation: color("syntaxPunctuation")
    },
    markdown: {
      text: color("markdownText"),
      heading: color("markdownHeading"),
      link: color("markdownLink"),
      linkText: color("markdownLinkText"),
      code: color("markdownCode"),
      blockQuote: color("markdownBlockQuote"),
      emphasis: color("markdownEmph"),
      strong: color("markdownStrong"),
      horizontalRule: color("markdownHorizontalRule"),
      listItem: color("markdownListItem"),
      listEnumeration: color("markdownListEnumeration"),
      image: color("markdownImage"),
      imageText: color("markdownImageText"),
      codeBlock: color("markdownCodeBlock")
    },
    "@dialog": {
      background: {
        base: dialogBackground(theme),
        action: { primary: { $hovered: "$background.raised.high" } }
      }
    }
  });
}
function dialogBackground(theme) {
  if (theme.backgroundPanel.a === 1)
    return "$background.raised.base";
  const visible = [theme.backgroundPanel, theme.backgroundMenu, theme.backgroundElement, theme.background].find((color) => color.a > 0);
  if (!visible)
    return luminance(theme.text) > 0.5 ? "#000000" : "#ffffff";
  const [red, green, blue] = visible.toInts();
  return hexInts(red, green, blue, 255);
}
function referenceHues(theme) {
  const definitions = theme.hue;
  if (!definitions)
    return theme;
  const scales = new Map;
  function resolve(name, chain = []) {
    const cached = scales.get(name);
    if (cached)
      return cached;
    if (chain.includes(name))
      return;
    const value = definitions?.[name];
    if (!value)
      return;
    if (typeof value !== "string") {
      scales.set(name, value);
      return value;
    }
    const target = /^\$hue\.([^.]+)$/.exec(value)?.[1];
    if (!target)
      return;
    const scale = resolve(target, [...chain, name]);
    if (scale)
      scales.set(name, scale);
    return scale;
  }
  const references = new Map;
  const index = (name, overwrite) => {
    const scale = resolve(name);
    if (!scale)
      return;
    HueStep.literals.forEach((step) => {
      const color = scale[step];
      if (!color || !overwrite && references.has(color.toLowerCase()))
        return;
      references.set(color.toLowerCase(), `$hue.${name}.${step}`);
    });
  };
  chromaticHues.forEach((name) => index(name, false));
  index("gray", false);
  index("accent", true);
  index("interactive", true);
  index("neutral", true);
  function replace(value) {
    if (typeof value === "string")
      return references.get(value.toLowerCase()) ?? value;
    if (!value || typeof value !== "object" || Array.isArray(value))
      return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
  }
  return Object.fromEntries(Object.entries(theme).map(([key, value]) => [key, key === "hue" || key === "categorical" ? value : replace(value)]));
}
function inferHues(theme) {
  const colors = [
    ["accent", theme.accent],
    ["success", theme.success],
    ["warning", theme.warning],
    ["primary", theme.primary],
    ["error", theme.error],
    ["info", theme.info],
    ["secondary", theme.secondary]
  ];
  const inferred = colors.reduce((result, [token, color]) => {
    const nearest = inferHue(color);
    if (!nearest)
      return result;
    const current = result.byHue[nearest.name];
    return {
      byHue: current && current.distance <= nearest.distance ? result.byHue : { ...result.byHue, [nearest.name]: { color, distance: nearest.distance } },
      byToken: { ...result.byToken, [token]: nearest.name }
    };
  }, { byHue: {}, byToken: {} });
  return [
    ["accent", theme.accent],
    ["primary", theme.primary]
  ].reduce((result, [token, color]) => {
    const nearest = inferHue(color);
    if (!nearest)
      return result;
    return {
      byHue: { ...result.byHue, [nearest.name]: { color, distance: nearest.distance } },
      byToken: { ...result.byToken, [token]: nearest.name }
    };
  }, inferred);
}
function inferHue(color) {
  const value = toOklch(color);
  if (ambiguous(color, value.c))
    return;
  const reference = value.l >= lightThreshold ? hueAngles.light : hueAngles.dark;
  return chromaticHues.map((name) => ({
    name,
    distance: hueDistance(value.h, reference[name])
  })).sort((first, second) => first.distance - second.distance)[0];
}
function hueDistance(first, second) {
  const difference = Math.abs(first - second);
  return Math.min(difference, 360 - difference);
}
function ambiguous(color, chroma = toOklch(color).c) {
  return color.toInts()[3] === 0 || chroma < minimumChroma;
}
function resolveV1(theme, mode) {
  const defs = theme.defs ?? {};
  function resolveColor(value, chain = []) {
    if (value instanceof RGBA)
      return value;
    if (typeof value === "string") {
      if (value === "transparent" || value === "none")
        return RGBA.fromInts(0, 0, 0, 0);
      if (value.startsWith("#"))
        return RGBA.fromHex(value);
      if (chain.includes(value))
        throw new Error(`Circular color reference: ${[...chain, value].join(" -> ")}`);
      const next = defs[value] ?? theme.theme[value];
      if (next === undefined)
        throw new Error(`Color reference "${value}" not found in defs or theme`);
      return resolveColor(next, [...chain, value]);
    }
    if (typeof value === "number")
      return ansi(value);
    if (!value || typeof value !== "object" || !(mode in value))
      throw new Error("Invalid V1 theme color");
    return resolveColor(value[mode], chain);
  }
  const resolved = Object.fromEntries(Object.entries(theme.theme).filter(([key]) => key !== "selectedListItemText" && key !== "backgroundMenu" && key !== "thinkingOpacity").map(([key, value]) => [key, resolveColor(value)]));
  const hasSelectedListItemText = theme.theme.selectedListItemText !== undefined;
  resolved.selectedListItemText = hasSelectedListItemText ? resolveColor(theme.theme.selectedListItemText) : resolved.background;
  resolved.backgroundMenu = theme.theme.backgroundMenu ? resolveColor(theme.theme.backgroundMenu) : resolved.backgroundElement;
  return {
    ...resolved,
    _hasSelectedListItemText: hasSelectedListItemText,
    thinkingOpacity: theme.theme.thinkingOpacity ?? 0.6
  };
}
function selectedForeground(theme, background) {
  if (theme._hasSelectedListItemText)
    return theme.selectedListItemText;
  if (theme.background.a !== 0)
    return theme.background;
  return 0.299 * background.r + 0.587 * background.g + 0.114 * background.b > 0.5 ? RGBA.fromInts(0, 0, 0) : RGBA.fromInts(255, 255, 255);
}
function hueScale(color, mode) {
  const value = toOklch(color);
  const anchor = 200;
  const endpoint = mode === "light" ? Math.max(0.97, value.l) : Math.min(0.18, value.l);
  const alpha = color.toInts()[3];
  return Object.fromEntries(HueStep.literals.map((step) => {
    if (step === anchor)
      return [step, hex(color)];
    const progress = (step - anchor) / (900 - anchor);
    const generated = oklchToHex({
      l: value.l + (endpoint - value.l) * progress,
      c: value.c * (1 - progress * 0.5),
      h: value.h
    });
    return [step, alpha === 255 ? generated : `${generated}${byte(alpha)}`];
  }));
}
function neutralScale(theme) {
  const anchors = neutralAnchors(theme);
  return Object.fromEntries(HueStep.literals.map((step) => {
    const exact = anchors.find((anchor) => anchor.step === step);
    if (exact)
      return [step, hex(exact.color)];
    const first = anchors[0];
    const last = anchors.at(-1);
    const [lower, upper] = step < first.step ? [first, anchors[1]] : step > last.step ? [anchors.at(-2), last] : [anchors.filter((anchor) => anchor.step < step).at(-1), anchors.find((anchor) => anchor.step > step)];
    return [step, interpolate(lower.color, upper.color, (step - lower.step) / (upper.step - lower.step))];
  }));
}
function neutralAnchors(theme) {
  const light = [
    { step: 200, color: theme.background },
    { step: 300, color: theme.backgroundPanel },
    { step: 400, color: theme.backgroundElement || theme.backgroundMenu },
    { step: 600, color: theme.textMuted },
    { step: 800, color: theme.text }
  ];
  return light.toReversed().map((source) => ({ ...source, step: 1000 - source.step }));
}
function interpolate(first, second, amount) {
  const start = toOklch(first);
  const end = toOklch(second);
  const startHue = Number.isFinite(start.h) ? start.h : Number.isFinite(end.h) ? end.h : 0;
  const endHue = Number.isFinite(end.h) ? end.h : startHue;
  const hue = ((endHue - startHue) % 360 + 540) % 360 - 180;
  const generated = oklchToHex({
    l: start.l + (end.l - start.l) * amount,
    c: start.c + (end.c - start.c) * amount,
    h: startHue + hue * amount
  });
  const alpha = Math.max(0, Math.min(255, Math.round(first.toInts()[3] + (second.toInts()[3] - first.toInts()[3]) * amount)));
  return alpha === 255 ? generated : `${generated}${byte(alpha)}`;
}
function toOklch(color) {
  const [red, green, blue] = color.toInts();
  return rgbToOklch(red / 255, green / 255, blue / 255);
}
function hex(color) {
  return hexInts(...color.toInts());
}
function hexInts(r, g, b, a) {
  return `#${byte(r)}${byte(g)}${byte(b)}${a === 255 ? "" : byte(a)}`;
}
function byte(value) {
  return value.toString(16).padStart(2, "0");
}
function ansi(code) {
  if (code < 16) {
    const colors = [
      "#000000",
      "#800000",
      "#008000",
      "#808000",
      "#000080",
      "#800080",
      "#008080",
      "#c0c0c0",
      "#808080",
      "#ff0000",
      "#00ff00",
      "#ffff00",
      "#0000ff",
      "#ff00ff",
      "#00ffff",
      "#ffffff"
    ];
    return RGBA.fromHex(colors[code] ?? "#000000");
  }
  if (code < 232) {
    const index = code - 16;
    const value = (part) => part === 0 ? 0 : part * 40 + 55;
    return RGBA.fromInts(value(Math.floor(index / 36)), value(Math.floor(index / 6) % 6), value(index % 6));
  }
  if (code < 256) {
    const gray = (code - 232) * 10 + 8;
    return RGBA.fromInts(gray, gray, gray);
  }
  return RGBA.fromInts(0, 0, 0);
}
// ../tui-base/src/vendor/theme/src/tui/v1-migrate-new-designs.ts
import { RGBA as RGBA2 } from "@opentui/core";
function migrateV1NewDesigns(theme) {
  const light = resolveV1(theme, "light");
  const dark = resolveV1(theme, "dark");
  if (light.background.a > 0 && dark.background.a > 0 && light.background.equals(dark.background)) {
    const lightMode = detectMode(light);
    const darkMode = detectMode(dark);
    if (lightMode === darkMode) {
      const definition = migrateMode2(lightMode === "light" ? light : dark, lightMode);
      if (lightMode === "light")
        return { base: base(definition), light: lightOverrides(definition, light) };
      return { base: base(definition), dark: { hue: definition.hue } };
    }
  }
  const lightDefinition = migrateMode2(light, "light");
  const darkDefinition = migrateMode2(dark, "dark");
  return {
    base: base(lightDefinition),
    light: lightOverrides(lightDefinition, light),
    dark: darkDefinition
  };
}
var lightDialog = {
  background: {
    base: "$hue.neutral.800",
    raised: { high: "$hue.neutral.700" },
    action: {
      primary: { $hovered: "$hue.neutral.600" },
      secondary: { $hovered: "$hue.neutral.600" }
    }
  }
};
function lightOverrides(definition, theme) {
  if (theme.backgroundPanel.a === 1)
    return { hue: definition.hue, "@dialog": lightDialog };
  return {
    hue: definition.hue,
    "@dialog": { ...lightDialog, background: { ...lightDialog.background, base: dialogBackground(theme) } }
  };
}
function migrateMode2(theme, mode) {
  const color = (key) => hex(theme[key]);
  const neutral = neutralScale2(theme, mode);
  const primary = "$hue.interactive.400";
  return referenceHues({
    ...paletteHues(theme, neutral.scale, (color) => hueScale2(color, mode, neutral)),
    text: {
      base: "$hue.neutral.100",
      muted: "$hue.neutral.200",
      faint: "$hue.neutral.300",
      action: {
        primary: {
          base: "$text.base",
          $disabled: "$text.faint",
          $focused: "$text.base",
          $selected: primary
        },
        secondary: { base: "$text.muted", $hovered: "$text.base", $focused: "$hue.interactive.200" },
        destructive: { base: hex(selectedForeground(theme, theme.error)), $disabled: "$text.faint" }
      },
      formfield: {
        base: "$text.base",
        $hovered: primary,
        $focused: primary,
        $pressed: primary,
        $disabled: "$text.faint",
        $selected: primary
      },
      feedback: {
        error: { base: color("error") },
        warning: { base: color("warning") },
        success: { base: color("success") },
        info: { base: color("info") }
      }
    },
    background: {
      base: "$hue.neutral.900",
      raised: {
        base: "$hue.neutral.700",
        high: "$hue.neutral.600",
        max: "$hue.neutral.500"
      },
      action: {
        primary: {
          base: "transparent",
          $hovered: "$hue.neutral.700",
          $focused: "$hue.interactive.600",
          $selected: "transparent"
        },
        secondary: { base: "transparent" },
        destructive: { base: color("error") }
      },
      formfield: {
        base: "$background.base"
      },
      feedback: {
        error: { base: "$background.base" },
        warning: { base: "$background.base" },
        success: { base: "$background.base" },
        info: { base: "$background.base" }
      }
    },
    ...paletteTokens(theme),
    "@dialog": {
      background: {
        base: dialogBackground(theme),
        action: {
          primary: { $hovered: "$background.raised.max" },
          secondary: { $hovered: "$background.raised.max" }
        }
      }
    }
  });
}
var profiles = {
  dark: {
    surface: { 900: 0, 800: 0.039, 700: 0.057, 600: 0.11, 500: 0.175, 400: 0.253 },
    text: { 200: 0.719, 300: 0.538 },
    hueLightness: { 100: -0.035, 200: -0.023, 300: -0.003, 600: 0.095, 700: 0.071, 800: 0.024, 900: 0.012 },
    hueChroma: { 100: 0.1, 200: 0.24, 300: 0.22, 500: 0.64, 600: 0.2, 700: 0.14, 800: 0.09, 900: 0.07 },
    hueMid: 0.55,
    readable: { 800: 0.95, 700: 0.92, 600: 0.81, 500: 0.66, 900: 0.99 },
    readableHue: { 600: 0.7, 700: 0.82, 800: 0.92, 900: 0.99 }
  },
  light: {
    surface: { 900: 0, 800: -0.015, 700: -0.039, 600: -0.102, 500: -0.145, 400: -0.227 },
    text: { 200: 0.688, 300: 0.484 },
    hueLightness: { 100: 0.083, 200: 0.13, 300: 0.116, 600: 0.021, 700: -0.002, 800: -0.004, 900: -0.008 },
    hueChroma: { 100: 0.19, 200: 0.12, 300: 0.16, 500: 0.38, 600: 0.17, 700: 0.1, 800: 0.05, 900: 0.02 },
    hueMid: 0.65,
    readable: { 800: 0.96, 700: 0.89, 600: 0.74, 500: 0.64, 900: 0.97 },
    readableHue: { 600: 0.78, 700: 0.88, 800: 0.93, 900: 0.97 }
  }
};
var minimumSurfaceContrast = 4.5;
var maximumDimming = 0.6;
function neutralScale2(theme, mode) {
  const profile = profiles[mode];
  const opaque = (color) => color.toInts()[3] > 0;
  const element = [theme.backgroundElement, theme.backgroundMenu].find(opaque);
  const sources = [
    { step: 900, color: theme.background },
    { step: 700, color: theme.backgroundPanel },
    { step: 600, color: element }
  ];
  const reference = sources.find((source) => source.color && opaque(source.color));
  const page = reference ? toOklch(reference.color) : toOklch(mode === "dark" ? RGBA2.fromInts(0, 0, 0) : RGBA2.fromInts(255, 255, 255));
  const pageLightness = page.l - (reference ? profile.surface[reference.step] : 0);
  const tint = (...colors) => {
    const color = colors.find((color) => color && opaque(color));
    return color ? toOklch(color) : page;
  };
  const surfaceTint = {
    900: tint(theme.background, theme.backgroundPanel, element),
    800: tint(theme.backgroundPanel, theme.background, element),
    700: tint(theme.backgroundPanel, theme.background, element),
    600: tint(element, theme.backgroundPanel, theme.background),
    500: tint(element, theme.backgroundPanel, theme.background),
    400: tint(element, theme.backgroundPanel, theme.background)
  };
  const lightness = {};
  const planned = {};
  const scale = {};
  const text = toOklch(theme.text);
  const pageColor = { ...surfaceTint[900], l: pageLightness };
  const pageContrast = contrast(theme.text, RGBA2.fromHex(oklchToHex(pageColor)));
  const readable = (color, share) => {
    const target = Math.max(pageContrast * share, Math.min(minimumSurfaceContrast, pageContrast * 0.95));
    const passes = (amount) => contrast(theme.text, RGBA2.fromHex(oklchToHex(mix2(color, pageColor, amount)))) >= target;
    if (passes(0))
      return color;
    if (!passes(maximumDimming))
      return mix2(color, pageColor, maximumDimming);
    let [low, high] = [0, maximumDimming];
    for (let index = 0;index < 12; index++) {
      const amount = (low + high) / 2;
      if (passes(amount))
        high = amount;
      else
        low = amount;
    }
    return mix2(color, pageColor, high);
  };
  for (const step of [800, 700, 600, 500, 400]) {
    const generated = { ...surfaceTint[step], l: pageLightness + profile.surface[step] };
    const color = step === 400 ? generated : readable(generated, profile.readable[step]);
    planned[step] = generated.l;
    lightness[step] = color.l;
    scale[step] = oklchToHex(color);
  }
  lightness[900] = pageLightness;
  scale[900] = hex(theme.background);
  for (const [step, color] of [
    [800, theme.backgroundPanel],
    [700, theme.backgroundPanel],
    [600, theme.backgroundElement]
  ]) {
    if (!opaque(color))
      scale[step] = hex(color);
  }
  lightness[100] = text.l;
  scale[100] = hex(theme.text);
  for (const step of [200, 300]) {
    const generated = mix2(pageColor, text, profile.text[step]);
    lightness[step] = generated.l;
    scale[step] = oklchToHex(generated);
  }
  const muted = toOklch(theme.textMuted);
  const mutedStep = Math.abs(muted.l - lightness[200]) <= Math.abs(muted.l - lightness[300]) ? 200 : 300;
  lightness[mutedStep] = muted.l;
  scale[mutedStep] = hex(theme.textMuted);
  return { scale, lightness: { ...lightness, ...planned }, readable };
}
function hueScale2(color, mode, neutral) {
  const profile = profiles[mode];
  const anchor = toOklch(color);
  const alpha = color.toInts()[3];
  const generate = (generated) => {
    const value = oklchToHex(generated);
    return alpha === 255 ? value : `${value}${byte(alpha)}`;
  };
  const lightness = (step) => neutral.lightness[step] + profile.hueLightness[step];
  return Object.fromEntries(HueStep.literals.map((step) => {
    if (step === 400)
      return [step, hex(color)];
    const generated = {
      l: step === 500 ? anchor.l + (lightness(600) - anchor.l) * profile.hueMid : lightness(step),
      c: anchor.c * profile.hueChroma[step],
      h: anchor.h
    };
    if (step === 600 || step === 700 || step === 800 || step === 900)
      return [step, generate(neutral.readable(generated, profile.readableHue[step]))];
    return [step, generate(generated)];
  }));
}
function contrast(first, second) {
  const luminance = (color) => {
    const channel = (value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  };
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}
function mix2(start, end, amount) {
  const startHue = start.c > 0.002 ? start.h : end.h;
  const endHue = end.c > 0.002 ? end.h : startHue;
  const hue = ((endHue - startHue) % 360 + 540) % 360 - 180;
  return {
    l: start.l + (end.l - start.l) * amount,
    c: start.c + (end.c - start.c) * amount,
    h: startHue + hue * amount
  };
}
function paletteHues(theme, gray, scale) {
  const hues = inferHues(theme);
  const categorical = categoricalTokens.flatMap((token) => {
    const hue = hues.byToken[token];
    return hue ? [hue] : [];
  });
  const uniqueCategorical = categorical.filter((hue, index) => categorical.indexOf(hue) === index);
  return {
    hue: {
      gray,
      ...Object.fromEntries(chromaticHues.flatMap((name) => {
        const match = hues.byHue[name];
        return match ? [[name, scale(match.color)]] : [];
      })),
      accent: hues.byToken.accent ? `$hue.${hues.byToken.accent}` : "$hue.gray",
      interactive: hues.byToken.primary ? `$hue.${hues.byToken.primary}` : "$hue.gray",
      neutral: "$hue.gray"
    },
    categorical: uniqueCategorical.length ? uniqueCategorical : ["neutral"]
  };
}
function paletteTokens(theme) {
  const color = (key) => hex(theme[key]);
  return {
    border: { base: color("border") },
    scrollbar: { base: color("borderActive") },
    diff: {
      text: {
        added: color("diffAdded"),
        removed: color("diffRemoved"),
        context: color("diffContext"),
        hunkHeader: color("diffHunkHeader")
      },
      background: {
        added: color("diffAddedBg"),
        removed: color("diffRemovedBg"),
        context: color("diffContextBg")
      },
      highlight: { added: color("diffHighlightAdded"), removed: color("diffHighlightRemoved") },
      lineNumber: {
        text: color("diffLineNumber"),
        background: {
          added: color("diffAddedLineNumberBg"),
          removed: color("diffRemovedLineNumberBg")
        }
      }
    },
    syntax: {
      comment: color("syntaxComment"),
      keyword: color("syntaxKeyword"),
      function: color("syntaxFunction"),
      variable: color("syntaxVariable"),
      string: color("syntaxString"),
      number: color("syntaxNumber"),
      type: color("syntaxType"),
      operator: color("syntaxOperator"),
      punctuation: color("syntaxPunctuation")
    },
    markdown: {
      text: color("markdownText"),
      heading: color("markdownHeading"),
      link: color("markdownLink"),
      linkText: color("markdownLinkText"),
      code: color("markdownCode"),
      blockQuote: color("markdownBlockQuote"),
      emphasis: color("markdownEmph"),
      strong: color("markdownStrong"),
      horizontalRule: color("markdownHorizontalRule"),
      listItem: color("markdownListItem"),
      listEnumeration: color("markdownListEnumeration"),
      image: color("markdownImage"),
      imageText: color("markdownImageText"),
      codeBlock: color("markdownCodeBlock")
    }
  };
}
// ../tui-base/src/vendor/theme/src/tui/resolve.ts
import { RGBA as RGBA3 } from "@opentui/core";

// ../tui-base/src/vendor/theme/src/tui/select.ts
function selectThemeMode(document, mode = "light") {
  const modes = themeModes(document);
  const selectedMode = modes.includes(mode) ? mode : modes[0];
  const selected = document[selectedMode];
  if (!selected)
    throw new Error("Theme must provide at least one mode");
  return { theme: mergeTheme(document.base, selected), mode: selectedMode };
}
function themeModes(document) {
  return ["light", "dark"].filter((mode) => document[mode] !== undefined);
}

// ../tui-base/src/vendor/theme/src/tui/resolve.ts
var decodeThemeDefinitionSchema = decodeUnknownSync(ThemeDefinition, { reportInput: true });
var decodeThemeDocumentSchema = decodeUnknownSync(ThemeDocument, { reportInput: true });
function themeDecodeError(error, name) {
  const message = isSchemaError2(error) ? error.message : String(error);
  const value = /got ("[^"]*"|\S+)/.exec(message)?.[1] ?? "value";
  return new Error(`Invalid theme: ${name} ${value} is an invalid value`, { cause: error });
}
function parseThemeDocument(input, name = "theme") {
  try {
    const document = decodeThemeDocumentSchema(input);
    themeModes(document).forEach((mode) => resolveThemeDocument(document, mode));
    return document;
  } catch (error) {
    throw themeDecodeError(error, name);
  }
}
function resolveThemeDocument(document, mode) {
  const selected = selectThemeMode(document, mode);
  const definition = expandTheme(selected.theme);
  return resolveExpandedTheme(definition);
}
function resolveExpandedTheme(definition) {
  const hue = resolveHue(definition.hue);
  const categorical = definition.categorical.map((name) => {
    const scale = hue[name];
    if (!scale)
      throw new Error(`Categorical hue "${name}" was not found`);
    return scale;
  });
  const hueSteps = compileHueSteps(hue);
  const base = tokens(definition);
  const views = {};
  const view = (tokens) => ({
    ...resolveView(tokens, hue, categorical, hueSteps),
    surface: (name) => views[name]
  });
  const dialog = definition["@dialog"];
  const dialogTokens = dialog ? contextualize(base, tokens(dialog)) : base;
  views.dialog = view(dialogTokens);
  const footer = dialog?.["@footer"];
  views["dialog.footer"] = footer ? view(contextualize(dialogTokens, footer)) : views.dialog;
  return view(base);
}
function tokens(definition) {
  return {
    text: definition.text,
    background: definition.background,
    border: definition.border,
    scrollbar: definition.scrollbar,
    diff: definition.diff,
    syntax: definition.syntax,
    markdown: definition.markdown
  };
}
function contextualize(base, override) {
  const result = mergeTheme(base, override);
  const text = result["text"];
  const background = result["background"];
  return {
    ...result,
    text: { ...text, action: contextualActions(base.text?.action, override.text?.action) },
    background: { ...background, action: contextualActions(base.background?.action, override.background?.action) }
  };
}
function contextualActions(base, surface) {
  return Object.fromEntries(ActionVariant.literals.map((variant) => {
    const baseVariant = base?.[variant];
    const surfaceVariant = surface?.[variant];
    return [
      variant,
      Object.fromEntries(["base", ...ActionState.literals].map((state) => {
        const key = state === "base" ? undefined : `$${state}`;
        return [
          key ?? "base",
          (key ? surfaceVariant?.[key] : undefined) ?? surfaceVariant?.base ?? (key ? baseVariant?.[key] : undefined) ?? baseVariant?.base
        ];
      }))
    ];
  }));
}
function resolveView(definition, hue, categorical, hueSteps) {
  const source = { hue, ...definition };
  const resolved = createResolver(source)(source, "theme");
  return {
    ...resolved,
    hue,
    categorical,
    text: {
      ...resolved.text,
      action: statefulActions(resolved.text.action),
      formfield: statefulColor(resolved.text.formfield)
    },
    background: {
      ...resolved.background,
      action: statefulActions(resolved.background.action),
      formfield: statefulColor(resolved.background.formfield)
    },
    ...hueSteps
  };
}
function statefulActions(actions) {
  return Object.fromEntries(ActionVariant.literals.map((variant) => [variant, statefulColor(actions[variant])]));
}
function statefulColor(color) {
  return {
    ...color,
    state: (states) => color[ActionState.literals.find((state) => states[state]) ?? "base"]
  };
}
function compileHueSteps(hue) {
  const index = new WeakMap;
  for (const [name, scale] of Object.entries(hue)) {
    HueStep.literals.forEach((step, position) => index.set(scale[step], { hue: name, step, position }));
  }
  const shift = (color, amount) => {
    const match = index.get(color);
    if (!match)
      return color;
    const offset = Number.isFinite(amount) ? Math.trunc(amount) : 0;
    const position = Math.max(0, Math.min(HueStep.literals.length - 1, match.position + offset));
    return hue[match.hue][HueStep.literals[position]];
  };
  return {
    source: (color) => {
      const match = index.get(color);
      return match ? { hue: match.hue, step: match.step } : undefined;
    },
    increase: (color, amount = 1) => shift(color, amount),
    decrease: (color, amount = 1) => shift(color, -amount)
  };
}
function resolveHue(definition) {
  const source = definition;
  const cache = new Map;
  function resolve(name, stack) {
    const hit = cache.get(name);
    if (hit)
      return hit;
    if (stack.includes(name))
      throw new Error(`Circular hue reference: ${[...stack, name].join(" -> ")}`);
    const value = source[name];
    if (typeof value === "string") {
      const match = /^\$hue\.(.+)$/.exec(value);
      if (!match?.[1])
        throw new Error(`Hue alias "${value}" must reference a hue scale`);
      if (source[match[1]] === undefined)
        throw new Error(`Hue alias "${value}" references a missing hue`);
      const target = resolve(match[1], [...stack, name]);
      const result = Object.fromEntries(HueStep.literals.map((step) => [step, RGBA3.clone(target[step])]));
      cache.set(name, result);
      return result;
    }
    if (!isRecord2(value))
      throw new Error(`Hue "${name}" was not found`);
    const result = Object.fromEntries(HueStep.literals.map((step) => {
      const color = value[step];
      if (typeof color !== "string" || !isHex(color))
        throw new Error(`Invalid hue color at "hue.${name}.${step}"`);
      return [step, RGBA3.fromHex(color)];
    }));
    for (const step of Object.keys(value)) {
      if (!HueStep.literals.includes(Number(step)))
        throw new Error(`Unknown hue step at "hue.${name}.${step}"`);
    }
    cache.set(name, result);
    return result;
  }
  return Object.fromEntries(Object.keys(source).map((name) => [name, resolve(name, [])]));
}
function createResolver(source) {
  const cache = new Map;
  function resolve(value, path, stack = []) {
    if (value instanceof RGBA3)
      return value;
    if (typeof value === "string")
      return resolveColor(value, path, stack);
    if (typeof value === "number")
      return value;
    if (!isRecord2(value))
      throw new Error(`Invalid theme value at "${path}"`);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [resolvedKey(key), resolve(item, `${path}.${key}`, stack)]));
  }
  function resolveColor(value, path, stack) {
    if (value === "transparent")
      return RGBA3.fromInts(0, 0, 0, 0);
    if (isHex(value))
      return RGBA3.fromHex(value);
    if (!value.startsWith("$"))
      throw new Error(`Invalid color "${value}" at "${path}"`);
    const target = value.slice(1);
    const hit = cache.get(target);
    if (hit)
      return hit;
    if (stack.includes(target))
      throw new Error(`Circular theme reference: ${[...stack, target].join(" -> ")}`);
    const result = resolve(readColor(source, target), target, [...stack, target]);
    if (!(result instanceof RGBA3))
      throw new Error(`Theme reference "${value}" at "${path}" is not a color`);
    cache.set(target, result);
    return result;
  }
  return (value, path) => resolve(value, path);
}
function readColor(source, path) {
  const match = /^hue\.(.+)\.(100|200|300|400|500|600|700|800|900)$/.exec(path);
  if (!match?.[1] || !match[2])
    return read(source, path);
  const scales = source.hue;
  const scale = isRecord2(scales) ? scales[match[1]] : undefined;
  const color = isRecord2(scale) ? scale[match[2]] : undefined;
  if (color === undefined)
    throw new Error(`Theme reference "$${path}" was not found`);
  return color;
}
function resolvedKey(key) {
  if (!key.startsWith("$"))
    return key;
  const state = key.slice(1);
  return ActionState.literals.includes(state) ? state : key;
}
function read(source, path) {
  const result = path.split(".").reduce((value, key) => isRecord2(value) ? value[key] : undefined, source);
  if (result === undefined)
    throw new Error(`Theme reference "$${path}" was not found`);
  return result;
}
function isHex(value) {
  return /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value);
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof RGBA3);
}
// ../tui-base/src/vendor/theme/src/tui/syntax.ts
import { SyntaxStyle } from "@opentui/core";
function generateSyntax(theme, owner) {
  const step = 200;
  const syntax = theme.syntax;
  const markdown = theme.markdown;
  const feedback = theme.text.feedback;
  const rules = [
    rule(["default"], theme.text.base),
    rule(["prompt"], theme.hue.accent[step]),
    rule(["extmark.file"], feedback.warning.base, { bold: true }),
    rule(["extmark.agent"], theme.categorical[0][step], { bold: true }),
    rule(["extmark.skill"], (theme.categorical[1] ?? theme.categorical[0])[step], { bold: true }),
    rule(["extmark.paste"], theme.text.action.primary.focused, {
      background: feedback.warning.base,
      bold: true
    }),
    rule(["comment", "comment.documentation"], syntax.comment, { italic: true }),
    rule(["string", "symbol", "character.special", "character"], syntax.string),
    rule(["number", "boolean", "constant", "float"], syntax.number),
    rule(["keyword.return", "keyword.conditional", "keyword.repeat", "keyword.coroutine"], syntax.keyword, {
      italic: true
    }),
    rule(["keyword.type"], syntax.type, { bold: true, italic: true }),
    rule(["keyword.function", "function.method"], syntax.function),
    rule(["keyword"], syntax.keyword, { italic: true }),
    rule(["keyword.import", "string.escape", "string.regexp", "tag.attribute", "keyword.export"], syntax.keyword),
    rule(["operator", "keyword.operator", "punctuation.delimiter", "keyword.conditional.ternary"], syntax.operator),
    rule(["variable", "variable.parameter", "function.method.call", "function.call", "property", "parameter", "field"], syntax.variable),
    rule(["variable.member", "function", "constructor"], syntax.function),
    rule(["type", "module", "class", "namespace"], syntax.type),
    rule(["type.definition"], syntax.type, { bold: true }),
    rule(["punctuation", "punctuation.bracket"], syntax.punctuation),
    rule(["variable.builtin", "type.builtin", "function.builtin", "module.builtin", "constant.builtin", "variable.super"], feedback.error.base),
    rule(["keyword.directive", "keyword.modifier", "keyword.exception"], syntax.keyword, { italic: true }),
    rule(["punctuation.special", "tag.delimiter"], syntax.operator),
    rule([
      "markup.heading",
      "markup.heading.2",
      "markup.heading.3",
      "markup.heading.4",
      "markup.heading.5",
      "markup.heading.6"
    ], markdown.heading, { bold: true }),
    rule(["markup.heading.1"], markdown.heading, { bold: true, underline: true }),
    rule(["markup.bold", "markup.strong"], markdown.strong, { bold: true }),
    rule(["markup.italic"], markdown.emphasis, { italic: true }),
    rule(["markup.list"], markdown.listItem),
    rule(["markup.quote"], markdown.blockQuote, { italic: true }),
    rule(["markup.raw", "markup.raw.block"], markdown.code),
    rule(["markup.raw.inline"], markdown.code, { background: theme.background.base }),
    rule(["markup.link", "markup.link.url", "string.special", "string.special.url"], markdown.link, {
      underline: true
    }),
    rule(["markup.link.label"], markdown.linkText, { underline: true }),
    rule(["label"], markdown.linkText),
    rule(["spell", "nospell"], theme.text.base),
    rule(["markup.underline"], theme.text.base, { underline: true }),
    rule(["comment.error"], feedback.error.base, { italic: true, bold: true }),
    rule(["comment.warning"], feedback.warning.base, { italic: true, bold: true }),
    rule(["comment.todo", "comment.note"], feedback.info.base, { italic: true, bold: true }),
    rule(["attribute", "annotation"], feedback.warning.base),
    rule(["tag"], feedback.error.base),
    rule(["markup.strikethrough", "markup.list.unchecked", "debug"], theme.text.muted),
    rule(["markup.list.checked"], feedback.success.base),
    rule(["diff.plus"], theme.diff.text.added, { background: theme.diff.background.added }),
    rule(["diff.minus"], theme.diff.text.removed, { background: theme.diff.background.removed }),
    rule(["diff.delta"], theme.diff.text.context, { background: theme.diff.background.context }),
    rule(["error"], feedback.error.base, { bold: true }),
    rule(["warning"], feedback.warning.base, { bold: true }),
    rule(["info"], feedback.info.base)
  ];
  return SyntaxStyle.fromTheme(rules, owner);
}
function rule(scope, foreground, style = {}) {
  return { scope, style: { foreground, ...style } };
}
// ../tui-base/src/theme/resolve.ts
import { RGBA as RGBA5 } from "@opentui/core";

// ../tui-base/src/theme/color.ts
import { RGBA as RGBA4 } from "@opentui/core";
function ansiToRgba(code) {
  if (code < 16) {
    const ansiColors = [
      "#000000",
      "#800000",
      "#008000",
      "#808000",
      "#000080",
      "#800080",
      "#008080",
      "#c0c0c0",
      "#808080",
      "#ff0000",
      "#00ff00",
      "#ffff00",
      "#0000ff",
      "#ff00ff",
      "#00ffff",
      "#ffffff"
    ];
    return RGBA4.fromHex(ansiColors[code] ?? "#000000");
  }
  if (code < 232) {
    const index = code - 16;
    const b = index % 6;
    const g = Math.floor(index / 6) % 6;
    const r = Math.floor(index / 36);
    const val = (x) => x === 0 ? 0 : x * 40 + 55;
    return RGBA4.fromInts(val(r), val(g), val(b));
  }
  if (code < 256) {
    const gray = (code - 232) * 10 + 8;
    return RGBA4.fromInts(gray, gray, gray);
  }
  return RGBA4.fromInts(0, 0, 0);
}
function tint(base, overlay, alpha) {
  const r = base.r + (overlay.r - base.r) * alpha;
  const g = base.g + (overlay.g - base.g) * alpha;
  const b = base.b + (overlay.b - base.b) * alpha;
  return RGBA4.fromInts(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255));
}
// ../tui-base/src/theme/assets/aura.json
var aura_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    darkBg: "#0f0f0f",
    darkBgPanel: "#15141b",
    darkBorder: "#2d2d2d",
    darkFgMuted: "#6d6d6d",
    darkFg: "#edecee",
    purple: "#a277ff",
    pink: "#f694ff",
    blue: "#82e2ff",
    red: "#ff6767",
    orange: "#ffca85",
    cyan: "#61ffca",
    green: "#9dff65"
  },
  theme: {
    primary: "purple",
    secondary: "pink",
    accent: "purple",
    error: "red",
    warning: "orange",
    success: "cyan",
    info: "purple",
    text: "darkFg",
    textMuted: "darkFgMuted",
    background: "darkBg",
    backgroundPanel: "darkBgPanel",
    backgroundElement: "darkBgPanel",
    border: "darkBorder",
    borderActive: "darkFgMuted",
    borderSubtle: "darkBorder",
    diffAdded: "cyan",
    diffRemoved: "red",
    diffContext: "darkFgMuted",
    diffHunkHeader: "darkFgMuted",
    diffHighlightAdded: "cyan",
    diffHighlightRemoved: "red",
    diffAddedBg: "#354933",
    diffRemovedBg: "#3f191a",
    diffContextBg: "darkBgPanel",
    diffLineNumber: "#898989",
    diffAddedLineNumberBg: "#162620",
    diffRemovedLineNumberBg: "#26161a",
    markdownText: "darkFg",
    markdownHeading: "purple",
    markdownLink: "pink",
    markdownLinkText: "purple",
    markdownCode: "cyan",
    markdownBlockQuote: "darkFgMuted",
    markdownEmph: "orange",
    markdownStrong: "purple",
    markdownHorizontalRule: "darkFgMuted",
    markdownListItem: "purple",
    markdownListEnumeration: "purple",
    markdownImage: "pink",
    markdownImageText: "purple",
    markdownCodeBlock: "darkFg",
    syntaxComment: "darkFgMuted",
    syntaxKeyword: "pink",
    syntaxFunction: "purple",
    syntaxVariable: "purple",
    syntaxString: "cyan",
    syntaxNumber: "green",
    syntaxType: "purple",
    syntaxOperator: "pink",
    syntaxPunctuation: "darkFg"
  }
};
// ../tui-base/src/theme/assets/ayu.json
var ayu_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    darkBg: "#0B0E14",
    darkBgAlt: "#0D1017",
    darkLine: "#11151C",
    darkPanel: "#0F131A",
    darkFg: "#BFBDB6",
    darkFgMuted: "#565B66",
    darkGutter: "#6C7380",
    darkTag: "#39BAE6",
    darkFunc: "#FFB454",
    darkEntity: "#59C2FF",
    darkString: "#AAD94C",
    darkRegexp: "#95E6CB",
    darkMarkup: "#F07178",
    darkKeyword: "#FF8F40",
    darkSpecial: "#E6B673",
    darkComment: "#ACB6BF",
    darkConstant: "#D2A6FF",
    darkOperator: "#F29668",
    darkAdded: "#7FD962",
    darkRemoved: "#F26D78",
    darkAccent: "#E6B450",
    darkError: "#D95757",
    darkIndentActive: "#6C7380"
  },
  theme: {
    primary: "darkEntity",
    secondary: "darkConstant",
    accent: "darkAccent",
    error: "darkError",
    warning: "darkSpecial",
    success: "darkAdded",
    info: "darkTag",
    text: "darkFg",
    textMuted: "darkFgMuted",
    background: "darkBg",
    backgroundPanel: "darkPanel",
    backgroundElement: "darkBgAlt",
    border: "darkGutter",
    borderActive: "darkIndentActive",
    borderSubtle: "darkLine",
    diffAdded: "darkAdded",
    diffRemoved: "darkRemoved",
    diffContext: "darkComment",
    diffHunkHeader: "darkComment",
    diffHighlightAdded: "darkString",
    diffHighlightRemoved: "darkMarkup",
    diffAddedBg: "#20303b",
    diffRemovedBg: "#37222c",
    diffContextBg: "darkPanel",
    diffLineNumber: "diffContext",
    diffAddedLineNumberBg: "#1b2b34",
    diffRemovedLineNumberBg: "#2d1f26",
    markdownText: "darkFg",
    markdownHeading: "darkConstant",
    markdownLink: "darkEntity",
    markdownLinkText: "darkTag",
    markdownCode: "darkString",
    markdownBlockQuote: "darkSpecial",
    markdownEmph: "darkSpecial",
    markdownStrong: "darkFunc",
    markdownHorizontalRule: "darkFgMuted",
    markdownListItem: "darkEntity",
    markdownListEnumeration: "darkTag",
    markdownImage: "darkEntity",
    markdownImageText: "darkTag",
    markdownCodeBlock: "darkFg",
    syntaxComment: "darkComment",
    syntaxKeyword: "darkKeyword",
    syntaxFunction: "darkFunc",
    syntaxVariable: "darkEntity",
    syntaxString: "darkString",
    syntaxNumber: "darkConstant",
    syntaxType: "darkSpecial",
    syntaxOperator: "darkOperator",
    syntaxPunctuation: "darkFg"
  }
};
// ../tui-base/src/theme/assets/carbonfox.json
var carbonfox_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    bg0: "#0d0d0d",
    bg1: "#161616",
    bg1a: "#1a1a1a",
    bg2: "#1e1e1e",
    bg3: "#262626",
    bg4: "#303030",
    fg0: "#ffffff",
    fg1: "#f2f4f8",
    fg2: "#a9afbc",
    fg3: "#7d848f",
    lbg0: "#ffffff",
    lbg1: "#f4f4f4",
    lbg2: "#e8e8e8",
    lbg3: "#dcdcdc",
    lfg0: "#000000",
    lfg1: "#161616",
    lfg2: "#525252",
    lfg3: "#6f6f6f",
    red: "#ee5396",
    green: "#25be6a",
    yellow: "#08bdba",
    blue: "#78a9ff",
    magenta: "#be95ff",
    cyan: "#33b1ff",
    white: "#dfdfe0",
    orange: "#3ddbd9",
    pink: "#ff7eb6",
    blueBright: "#8cb6ff",
    cyanBright: "#52c7ff",
    greenBright: "#46c880",
    redLight: "#9f1853",
    greenLight: "#198038",
    yellowLight: "#007d79",
    blueLight: "#0043ce",
    magentaLight: "#6929c4",
    cyanLight: "#0072c3",
    warning: "#f1c21b",
    diffGreen: "#50fa7b",
    diffRed: "#ff6b6b",
    diffGreenBg: "#0f2418",
    diffRedBg: "#2a1216"
  },
  theme: {
    primary: {
      dark: "cyan",
      light: "blueLight"
    },
    secondary: {
      dark: "blue",
      light: "blueLight"
    },
    accent: {
      dark: "pink",
      light: "redLight"
    },
    error: {
      dark: "red",
      light: "redLight"
    },
    warning: {
      dark: "warning",
      light: "yellowLight"
    },
    success: {
      dark: "green",
      light: "greenLight"
    },
    info: {
      dark: "blue",
      light: "blueLight"
    },
    text: {
      dark: "fg1",
      light: "lfg1"
    },
    textMuted: {
      dark: "fg3",
      light: "lfg3"
    },
    background: {
      dark: "bg1",
      light: "lbg0"
    },
    backgroundPanel: {
      dark: "bg1a",
      light: "lbg1"
    },
    backgroundElement: {
      dark: "bg2",
      light: "lbg1"
    },
    border: {
      dark: "bg4",
      light: "lbg3"
    },
    borderActive: {
      dark: "cyan",
      light: "blueLight"
    },
    borderSubtle: {
      dark: "bg3",
      light: "lbg2"
    },
    diffAdded: {
      dark: "diffGreen",
      light: "greenLight"
    },
    diffRemoved: {
      dark: "diffRed",
      light: "redLight"
    },
    diffContext: {
      dark: "fg3",
      light: "lfg3"
    },
    diffHunkHeader: {
      dark: "blue",
      light: "blueLight"
    },
    diffHighlightAdded: {
      dark: "#7dffaa",
      light: "greenLight"
    },
    diffHighlightRemoved: {
      dark: "#ff9999",
      light: "redLight"
    },
    diffAddedBg: {
      dark: "diffGreenBg",
      light: "#defbe6"
    },
    diffRemovedBg: {
      dark: "diffRedBg",
      light: "#fff1f1"
    },
    diffContextBg: {
      dark: "bg1",
      light: "lbg1"
    },
    diffLineNumber: {
      dark: "#808792",
      light: "textMuted"
    },
    diffAddedLineNumberBg: {
      dark: "diffGreenBg",
      light: "#defbe6"
    },
    diffRemovedLineNumberBg: {
      dark: "diffRedBg",
      light: "#fff1f1"
    },
    markdownText: {
      dark: "fg1",
      light: "lfg1"
    },
    markdownHeading: {
      dark: "blueBright",
      light: "blueLight"
    },
    markdownLink: {
      dark: "blue",
      light: "blueLight"
    },
    markdownLinkText: {
      dark: "cyan",
      light: "cyanLight"
    },
    markdownCode: {
      dark: "green",
      light: "greenLight"
    },
    markdownBlockQuote: {
      dark: "fg3",
      light: "lfg3"
    },
    markdownEmph: {
      dark: "magenta",
      light: "magentaLight"
    },
    markdownStrong: {
      dark: "fg0",
      light: "lfg0"
    },
    markdownHorizontalRule: {
      dark: "bg4",
      light: "lbg3"
    },
    markdownListItem: {
      dark: "cyan",
      light: "cyanLight"
    },
    markdownListEnumeration: {
      dark: "cyan",
      light: "cyanLight"
    },
    markdownImage: {
      dark: "blue",
      light: "blueLight"
    },
    markdownImageText: {
      dark: "cyan",
      light: "cyanLight"
    },
    markdownCodeBlock: {
      dark: "fg2",
      light: "lfg2"
    },
    syntaxComment: {
      dark: "fg3",
      light: "lfg3"
    },
    syntaxKeyword: {
      dark: "magenta",
      light: "magentaLight"
    },
    syntaxFunction: {
      dark: "blueBright",
      light: "blueLight"
    },
    syntaxVariable: {
      dark: "white",
      light: "lfg1"
    },
    syntaxString: {
      dark: "green",
      light: "greenLight"
    },
    syntaxNumber: {
      dark: "orange",
      light: "yellowLight"
    },
    syntaxType: {
      dark: "yellow",
      light: "yellowLight"
    },
    syntaxOperator: {
      dark: "fg2",
      light: "lfg2"
    },
    syntaxPunctuation: {
      dark: "fg2",
      light: "lfg1"
    }
  }
};
// ../tui-base/src/theme/assets/catppuccin-frappe.json
var catppuccin_frappe_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    frappeRosewater: "#f2d5cf",
    frappeFlamingo: "#eebebe",
    frappePink: "#f4b8e4",
    frappeMauve: "#ca9ee6",
    frappeRed: "#e78284",
    frappeMaroon: "#ea999c",
    frappePeach: "#ef9f76",
    frappeYellow: "#e5c890",
    frappeGreen: "#a6d189",
    frappeTeal: "#81c8be",
    frappeSky: "#99d1db",
    frappeSapphire: "#85c1dc",
    frappeBlue: "#8da4e2",
    frappeLavender: "#babbf1",
    frappeText: "#c6d0f5",
    frappeSubtext1: "#b5bfe2",
    frappeSubtext0: "#a5adce",
    frappeOverlay2: "#949cb8",
    frappeOverlay1: "#838ba7",
    frappeOverlay0: "#737994",
    frappeSurface2: "#626880",
    frappeSurface1: "#51576d",
    frappeSurface0: "#414559",
    frappeBase: "#303446",
    frappeMantle: "#292c3c",
    frappeCrust: "#232634"
  },
  theme: {
    primary: {
      dark: "frappeBlue",
      light: "frappeBlue"
    },
    secondary: {
      dark: "frappeMauve",
      light: "frappeMauve"
    },
    accent: {
      dark: "frappePink",
      light: "frappePink"
    },
    error: {
      dark: "frappeRed",
      light: "frappeRed"
    },
    warning: {
      dark: "frappeYellow",
      light: "frappeYellow"
    },
    success: {
      dark: "frappeGreen",
      light: "frappeGreen"
    },
    info: {
      dark: "frappeTeal",
      light: "frappeTeal"
    },
    text: {
      dark: "frappeText",
      light: "frappeText"
    },
    textMuted: {
      dark: "frappeOverlay2",
      light: "frappeOverlay2"
    },
    background: {
      dark: "frappeBase",
      light: "frappeBase"
    },
    backgroundPanel: {
      dark: "frappeMantle",
      light: "frappeMantle"
    },
    backgroundElement: {
      dark: "frappeCrust",
      light: "frappeCrust"
    },
    border: {
      dark: "frappeSurface0",
      light: "frappeSurface0"
    },
    borderActive: {
      dark: "frappeSurface1",
      light: "frappeSurface1"
    },
    borderSubtle: {
      dark: "frappeSurface2",
      light: "frappeSurface2"
    },
    diffAdded: {
      dark: "frappeGreen",
      light: "frappeGreen"
    },
    diffRemoved: {
      dark: "frappeRed",
      light: "frappeRed"
    },
    diffContext: {
      dark: "frappeOverlay2",
      light: "frappeOverlay2"
    },
    diffHunkHeader: {
      dark: "frappePeach",
      light: "frappePeach"
    },
    diffHighlightAdded: {
      dark: "frappeGreen",
      light: "frappeGreen"
    },
    diffHighlightRemoved: {
      dark: "frappeRed",
      light: "frappeRed"
    },
    diffAddedBg: {
      dark: "#29342b",
      light: "#29342b"
    },
    diffRemovedBg: {
      dark: "#3a2a31",
      light: "#3a2a31"
    },
    diffContextBg: {
      dark: "frappeMantle",
      light: "frappeMantle"
    },
    diffLineNumber: "textMuted",
    diffAddedLineNumberBg: {
      dark: "#223025",
      light: "#223025"
    },
    diffRemovedLineNumberBg: {
      dark: "#2f242b",
      light: "#2f242b"
    },
    markdownText: {
      dark: "frappeText",
      light: "frappeText"
    },
    markdownHeading: {
      dark: "frappeMauve",
      light: "frappeMauve"
    },
    markdownLink: {
      dark: "frappeBlue",
      light: "frappeBlue"
    },
    markdownLinkText: {
      dark: "frappeSky",
      light: "frappeSky"
    },
    markdownCode: {
      dark: "frappeGreen",
      light: "frappeGreen"
    },
    markdownBlockQuote: {
      dark: "frappeYellow",
      light: "frappeYellow"
    },
    markdownEmph: {
      dark: "frappeYellow",
      light: "frappeYellow"
    },
    markdownStrong: {
      dark: "frappePeach",
      light: "frappePeach"
    },
    markdownHorizontalRule: {
      dark: "frappeSubtext0",
      light: "frappeSubtext0"
    },
    markdownListItem: {
      dark: "frappeBlue",
      light: "frappeBlue"
    },
    markdownListEnumeration: {
      dark: "frappeSky",
      light: "frappeSky"
    },
    markdownImage: {
      dark: "frappeBlue",
      light: "frappeBlue"
    },
    markdownImageText: {
      dark: "frappeSky",
      light: "frappeSky"
    },
    markdownCodeBlock: {
      dark: "frappeText",
      light: "frappeText"
    },
    syntaxComment: {
      dark: "frappeOverlay2",
      light: "frappeOverlay2"
    },
    syntaxKeyword: {
      dark: "frappeMauve",
      light: "frappeMauve"
    },
    syntaxFunction: {
      dark: "frappeBlue",
      light: "frappeBlue"
    },
    syntaxVariable: {
      dark: "frappeRed",
      light: "frappeRed"
    },
    syntaxString: {
      dark: "frappeGreen",
      light: "frappeGreen"
    },
    syntaxNumber: {
      dark: "frappePeach",
      light: "frappePeach"
    },
    syntaxType: {
      dark: "frappeYellow",
      light: "frappeYellow"
    },
    syntaxOperator: {
      dark: "frappeSky",
      light: "frappeSky"
    },
    syntaxPunctuation: {
      dark: "frappeText",
      light: "frappeText"
    }
  }
};
// ../tui-base/src/theme/assets/catppuccin-macchiato.json
var catppuccin_macchiato_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    macRosewater: "#f4dbd6",
    macFlamingo: "#f0c6c6",
    macPink: "#f5bde6",
    macMauve: "#c6a0f6",
    macRed: "#ed8796",
    macMaroon: "#ee99a0",
    macPeach: "#f5a97f",
    macYellow: "#eed49f",
    macGreen: "#a6da95",
    macTeal: "#8bd5ca",
    macSky: "#91d7e3",
    macSapphire: "#7dc4e4",
    macBlue: "#8aadf4",
    macLavender: "#b7bdf8",
    macText: "#cad3f5",
    macSubtext1: "#b8c0e0",
    macSubtext0: "#a5adcb",
    macOverlay2: "#939ab7",
    macOverlay1: "#8087a2",
    macOverlay0: "#6e738d",
    macSurface2: "#5b6078",
    macSurface1: "#494d64",
    macSurface0: "#363a4f",
    macBase: "#24273a",
    macMantle: "#1e2030",
    macCrust: "#181926"
  },
  theme: {
    primary: {
      dark: "macBlue",
      light: "macBlue"
    },
    secondary: {
      dark: "macMauve",
      light: "macMauve"
    },
    accent: {
      dark: "macPink",
      light: "macPink"
    },
    error: {
      dark: "macRed",
      light: "macRed"
    },
    warning: {
      dark: "macYellow",
      light: "macYellow"
    },
    success: {
      dark: "macGreen",
      light: "macGreen"
    },
    info: {
      dark: "macTeal",
      light: "macTeal"
    },
    text: {
      dark: "macText",
      light: "macText"
    },
    textMuted: {
      dark: "macOverlay2",
      light: "macOverlay2"
    },
    background: {
      dark: "macBase",
      light: "macBase"
    },
    backgroundPanel: {
      dark: "macMantle",
      light: "macMantle"
    },
    backgroundElement: {
      dark: "macCrust",
      light: "macCrust"
    },
    border: {
      dark: "macSurface0",
      light: "macSurface0"
    },
    borderActive: {
      dark: "macSurface1",
      light: "macSurface1"
    },
    borderSubtle: {
      dark: "macSurface2",
      light: "macSurface2"
    },
    diffAdded: {
      dark: "macGreen",
      light: "macGreen"
    },
    diffRemoved: {
      dark: "macRed",
      light: "macRed"
    },
    diffContext: {
      dark: "macOverlay2",
      light: "macOverlay2"
    },
    diffHunkHeader: {
      dark: "macPeach",
      light: "macPeach"
    },
    diffHighlightAdded: {
      dark: "macGreen",
      light: "macGreen"
    },
    diffHighlightRemoved: {
      dark: "macRed",
      light: "macRed"
    },
    diffAddedBg: {
      dark: "#29342b",
      light: "#29342b"
    },
    diffRemovedBg: {
      dark: "#3a2a31",
      light: "#3a2a31"
    },
    diffContextBg: {
      dark: "macMantle",
      light: "macMantle"
    },
    diffLineNumber: "textMuted",
    diffAddedLineNumberBg: {
      dark: "#223025",
      light: "#223025"
    },
    diffRemovedLineNumberBg: {
      dark: "#2f242b",
      light: "#2f242b"
    },
    markdownText: {
      dark: "macText",
      light: "macText"
    },
    markdownHeading: {
      dark: "macMauve",
      light: "macMauve"
    },
    markdownLink: {
      dark: "macBlue",
      light: "macBlue"
    },
    markdownLinkText: {
      dark: "macSky",
      light: "macSky"
    },
    markdownCode: {
      dark: "macGreen",
      light: "macGreen"
    },
    markdownBlockQuote: {
      dark: "macYellow",
      light: "macYellow"
    },
    markdownEmph: {
      dark: "macYellow",
      light: "macYellow"
    },
    markdownStrong: {
      dark: "macPeach",
      light: "macPeach"
    },
    markdownHorizontalRule: {
      dark: "macSubtext0",
      light: "macSubtext0"
    },
    markdownListItem: {
      dark: "macBlue",
      light: "macBlue"
    },
    markdownListEnumeration: {
      dark: "macSky",
      light: "macSky"
    },
    markdownImage: {
      dark: "macBlue",
      light: "macBlue"
    },
    markdownImageText: {
      dark: "macSky",
      light: "macSky"
    },
    markdownCodeBlock: {
      dark: "macText",
      light: "macText"
    },
    syntaxComment: {
      dark: "macOverlay2",
      light: "macOverlay2"
    },
    syntaxKeyword: {
      dark: "macMauve",
      light: "macMauve"
    },
    syntaxFunction: {
      dark: "macBlue",
      light: "macBlue"
    },
    syntaxVariable: {
      dark: "macRed",
      light: "macRed"
    },
    syntaxString: {
      dark: "macGreen",
      light: "macGreen"
    },
    syntaxNumber: {
      dark: "macPeach",
      light: "macPeach"
    },
    syntaxType: {
      dark: "macYellow",
      light: "macYellow"
    },
    syntaxOperator: {
      dark: "macSky",
      light: "macSky"
    },
    syntaxPunctuation: {
      dark: "macText",
      light: "macText"
    }
  }
};
// ../tui-base/src/theme/assets/catppuccin.json
var catppuccin_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    lightRosewater: "#dc8a78",
    lightFlamingo: "#dd7878",
    lightPink: "#ea76cb",
    lightMauve: "#8839ef",
    lightRed: "#d20f39",
    lightMaroon: "#e64553",
    lightPeach: "#fe640b",
    lightYellow: "#df8e1d",
    lightGreen: "#40a02b",
    lightTeal: "#179299",
    lightSky: "#04a5e5",
    lightSapphire: "#209fb5",
    lightBlue: "#1e66f5",
    lightLavender: "#7287fd",
    lightText: "#4c4f69",
    lightSubtext1: "#5c5f77",
    lightSubtext0: "#6c6f85",
    lightOverlay2: "#7c7f93",
    lightOverlay1: "#8c8fa1",
    lightOverlay0: "#9ca0b0",
    lightSurface2: "#acb0be",
    lightSurface1: "#bcc0cc",
    lightSurface0: "#ccd0da",
    lightBase: "#eff1f5",
    lightMantle: "#e6e9ef",
    lightCrust: "#dce0e8",
    darkRosewater: "#f5e0dc",
    darkFlamingo: "#f2cdcd",
    darkPink: "#f5c2e7",
    darkMauve: "#cba6f7",
    darkRed: "#f38ba8",
    darkMaroon: "#eba0ac",
    darkPeach: "#fab387",
    darkYellow: "#f9e2af",
    darkGreen: "#a6e3a1",
    darkTeal: "#94e2d5",
    darkSky: "#89dceb",
    darkSapphire: "#74c7ec",
    darkBlue: "#89b4fa",
    darkLavender: "#b4befe",
    darkText: "#cdd6f4",
    darkSubtext1: "#bac2de",
    darkSubtext0: "#a6adc8",
    darkOverlay2: "#9399b2",
    darkOverlay1: "#7f849c",
    darkOverlay0: "#6c7086",
    darkSurface2: "#585b70",
    darkSurface1: "#45475a",
    darkSurface0: "#313244",
    darkBase: "#1e1e2e",
    darkMantle: "#181825",
    darkCrust: "#11111b"
  },
  theme: {
    primary: { dark: "darkBlue", light: "lightBlue" },
    secondary: { dark: "darkMauve", light: "lightMauve" },
    accent: { dark: "darkPink", light: "lightPink" },
    error: { dark: "darkRed", light: "lightRed" },
    warning: { dark: "darkYellow", light: "lightYellow" },
    success: { dark: "darkGreen", light: "lightGreen" },
    info: { dark: "darkTeal", light: "lightTeal" },
    text: { dark: "darkText", light: "lightText" },
    textMuted: { dark: "darkOverlay2", light: "lightOverlay2" },
    background: { dark: "darkBase", light: "lightBase" },
    backgroundPanel: { dark: "darkMantle", light: "lightMantle" },
    backgroundElement: { dark: "darkCrust", light: "lightCrust" },
    border: { dark: "darkSurface0", light: "lightSurface0" },
    borderActive: { dark: "darkSurface1", light: "lightSurface1" },
    borderSubtle: { dark: "darkSurface2", light: "lightSurface2" },
    diffAdded: { dark: "darkGreen", light: "lightGreen" },
    diffRemoved: { dark: "darkRed", light: "lightRed" },
    diffContext: { dark: "darkOverlay2", light: "lightOverlay2" },
    diffHunkHeader: { dark: "darkPeach", light: "lightPeach" },
    diffHighlightAdded: { dark: "darkGreen", light: "lightGreen" },
    diffHighlightRemoved: { dark: "darkRed", light: "lightRed" },
    diffAddedBg: { dark: "#24312b", light: "#d6f0d9" },
    diffRemovedBg: { dark: "#3c2a32", light: "#f6dfe2" },
    diffContextBg: { dark: "darkMantle", light: "lightMantle" },
    diffLineNumber: { dark: "textMuted", light: "#5b5d63" },
    diffAddedLineNumberBg: { dark: "#1e2a25", light: "#c9e3cb" },
    diffRemovedLineNumberBg: { dark: "#32232a", light: "#e9d3d6" },
    markdownText: { dark: "darkText", light: "lightText" },
    markdownHeading: { dark: "darkMauve", light: "lightMauve" },
    markdownLink: { dark: "darkBlue", light: "lightBlue" },
    markdownLinkText: { dark: "darkSky", light: "lightSky" },
    markdownCode: { dark: "darkGreen", light: "lightGreen" },
    markdownBlockQuote: { dark: "darkYellow", light: "lightYellow" },
    markdownEmph: { dark: "darkYellow", light: "lightYellow" },
    markdownStrong: { dark: "darkPeach", light: "lightPeach" },
    markdownHorizontalRule: {
      dark: "darkSubtext0",
      light: "lightSubtext0"
    },
    markdownListItem: { dark: "darkBlue", light: "lightBlue" },
    markdownListEnumeration: { dark: "darkSky", light: "lightSky" },
    markdownImage: { dark: "darkBlue", light: "lightBlue" },
    markdownImageText: { dark: "darkSky", light: "lightSky" },
    markdownCodeBlock: { dark: "darkText", light: "lightText" },
    syntaxComment: { dark: "darkOverlay2", light: "lightOverlay2" },
    syntaxKeyword: { dark: "darkMauve", light: "lightMauve" },
    syntaxFunction: { dark: "darkBlue", light: "lightBlue" },
    syntaxVariable: { dark: "darkRed", light: "lightRed" },
    syntaxString: { dark: "darkGreen", light: "lightGreen" },
    syntaxNumber: { dark: "darkPeach", light: "lightPeach" },
    syntaxType: { dark: "darkYellow", light: "lightYellow" },
    syntaxOperator: { dark: "darkSky", light: "lightSky" },
    syntaxPunctuation: { dark: "darkText", light: "lightText" }
  }
};
// ../tui-base/src/theme/assets/cobalt2.json
var cobalt2_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    background: "#193549",
    backgroundAlt: "#122738",
    backgroundPanel: "#1f4662",
    foreground: "#ffffff",
    foregroundMuted: "#adb7c9",
    yellow: "#ffc600",
    yellowBright: "#ffe14c",
    orange: "#ff9d00",
    orangeBright: "#ffb454",
    mint: "#2affdf",
    mintBright: "#7efff5",
    blue: "#0088ff",
    blueBright: "#5cb7ff",
    pink: "#ff628c",
    pinkBright: "#ff86a5",
    green: "#9eff80",
    greenBright: "#b9ff9f",
    purple: "#9a5feb",
    purpleBright: "#b88cfd",
    red: "#ff0088",
    redBright: "#ff5fb3"
  },
  theme: {
    primary: {
      dark: "blue",
      light: "#0066cc"
    },
    secondary: {
      dark: "purple",
      light: "#7c4dff"
    },
    accent: {
      dark: "mint",
      light: "#00acc1"
    },
    error: {
      dark: "red",
      light: "#e91e63"
    },
    warning: {
      dark: "yellow",
      light: "#ff9800"
    },
    success: {
      dark: "green",
      light: "#4caf50"
    },
    info: {
      dark: "orange",
      light: "#ff5722"
    },
    text: {
      dark: "foreground",
      light: "#193549"
    },
    textMuted: {
      dark: "foregroundMuted",
      light: "#5c6b7d"
    },
    background: {
      dark: "#193549",
      light: "#ffffff"
    },
    backgroundPanel: {
      dark: "#122738",
      light: "#f5f7fa"
    },
    backgroundElement: {
      dark: "#1f4662",
      light: "#e8ecf1"
    },
    border: {
      dark: "#1f4662",
      light: "#d3dae3"
    },
    borderActive: {
      dark: "blue",
      light: "#0066cc"
    },
    borderSubtle: {
      dark: "#0e1e2e",
      light: "#e8ecf1"
    },
    diffAdded: {
      dark: "green",
      light: "#4caf50"
    },
    diffRemoved: {
      dark: "red",
      light: "#e91e63"
    },
    diffContext: {
      dark: "foregroundMuted",
      light: "#5c6b7d"
    },
    diffHunkHeader: {
      dark: "mint",
      light: "#00acc1"
    },
    diffHighlightAdded: {
      dark: "greenBright",
      light: "#4caf50"
    },
    diffHighlightRemoved: {
      dark: "redBright",
      light: "#e91e63"
    },
    diffAddedBg: {
      dark: "#1a3a2a",
      light: "#e8f5e9"
    },
    diffRemovedBg: {
      dark: "#3a1a2a",
      light: "#ffebee"
    },
    diffContextBg: {
      dark: "#122738",
      light: "#f5f7fa"
    },
    diffLineNumber: "textMuted",
    diffAddedLineNumberBg: {
      dark: "#1a3a2a",
      light: "#e8f5e9"
    },
    diffRemovedLineNumberBg: {
      dark: "#3a1a2a",
      light: "#ffebee"
    },
    markdownText: {
      dark: "foreground",
      light: "#193549"
    },
    markdownHeading: {
      dark: "yellow",
      light: "#ff9800"
    },
    markdownLink: {
      dark: "blue",
      light: "#0066cc"
    },
    markdownLinkText: {
      dark: "mint",
      light: "#00acc1"
    },
    markdownCode: {
      dark: "green",
      light: "#4caf50"
    },
    markdownBlockQuote: {
      dark: "foregroundMuted",
      light: "#5c6b7d"
    },
    markdownEmph: {
      dark: "orange",
      light: "#ff5722"
    },
    markdownStrong: {
      dark: "pink",
      light: "#e91e63"
    },
    markdownHorizontalRule: {
      dark: "#2d5a7b",
      light: "#d3dae3"
    },
    markdownListItem: {
      dark: "blue",
      light: "#0066cc"
    },
    markdownListEnumeration: {
      dark: "mint",
      light: "#00acc1"
    },
    markdownImage: {
      dark: "blue",
      light: "#0066cc"
    },
    markdownImageText: {
      dark: "mint",
      light: "#00acc1"
    },
    markdownCodeBlock: {
      dark: "foreground",
      light: "#193549"
    },
    syntaxComment: {
      dark: "#0088ff",
      light: "#5c6b7d"
    },
    syntaxKeyword: {
      dark: "orange",
      light: "#ff5722"
    },
    syntaxFunction: {
      dark: "yellow",
      light: "#ff9800"
    },
    syntaxVariable: {
      dark: "foreground",
      light: "#193549"
    },
    syntaxString: {
      dark: "green",
      light: "#4caf50"
    },
    syntaxNumber: {
      dark: "pink",
      light: "#e91e63"
    },
    syntaxType: {
      dark: "mint",
      light: "#00acc1"
    },
    syntaxOperator: {
      dark: "orange",
      light: "#ff5722"
    },
    syntaxPunctuation: {
      dark: "foreground",
      light: "#193549"
    }
  }
};
// ../tui-base/src/theme/assets/cursor.json
var cursor_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    darkBg: "#181818",
    darkPanel: "#141414",
    darkElement: "#262626",
    darkFg: "#e4e4e4",
    darkMuted: "#e4e4e45e",
    darkBorder: "#e4e4e413",
    darkBorderActive: "#e4e4e426",
    darkCyan: "#88c0d0",
    darkBlue: "#81a1c1",
    darkGreen: "#3fa266",
    darkGreenBright: "#70b489",
    darkRed: "#e34671",
    darkRedBright: "#fc6b83",
    darkYellow: "#f1b467",
    darkOrange: "#d2943e",
    darkPink: "#E394DC",
    darkPurple: "#AAA0FA",
    darkTeal: "#82D2CE",
    darkSyntaxYellow: "#F8C762",
    darkSyntaxOrange: "#EFB080",
    darkSyntaxGreen: "#A8CC7C",
    darkSyntaxBlue: "#87C3FF",
    lightBg: "#fcfcfc",
    lightPanel: "#f3f3f3",
    lightElement: "#ededed",
    lightFg: "#141414",
    lightMuted: "#141414ad",
    lightBorder: "#14141413",
    lightBorderActive: "#14141426",
    lightTeal: "#6f9ba6",
    lightBlue: "#3c7cab",
    lightBlueDark: "#206595",
    lightGreen: "#1f8a65",
    lightGreenBright: "#55a583",
    lightRed: "#cf2d56",
    lightRedBright: "#e75e78",
    lightOrange: "#db704b",
    lightYellow: "#c08532",
    lightPurple: "#9e94d5",
    lightPurpleDark: "#6049b3",
    lightPink: "#b8448b",
    lightMagenta: "#b3003f"
  },
  theme: {
    primary: {
      dark: "darkCyan",
      light: "lightTeal"
    },
    secondary: {
      dark: "darkBlue",
      light: "lightBlue"
    },
    accent: {
      dark: "darkCyan",
      light: "lightTeal"
    },
    error: {
      dark: "darkRed",
      light: "lightRed"
    },
    warning: {
      dark: "darkYellow",
      light: "lightOrange"
    },
    success: {
      dark: "darkGreen",
      light: "lightGreen"
    },
    info: {
      dark: "darkBlue",
      light: "lightBlue"
    },
    text: {
      dark: "darkFg",
      light: "lightFg"
    },
    textMuted: {
      dark: "darkMuted",
      light: "lightMuted"
    },
    background: {
      dark: "darkBg",
      light: "lightBg"
    },
    backgroundPanel: {
      dark: "darkPanel",
      light: "lightPanel"
    },
    backgroundElement: {
      dark: "darkElement",
      light: "lightElement"
    },
    border: {
      dark: "darkBorder",
      light: "lightBorder"
    },
    borderActive: {
      dark: "darkCyan",
      light: "lightTeal"
    },
    borderSubtle: {
      dark: "#0f0f0f",
      light: "#e0e0e0"
    },
    diffAdded: {
      dark: "darkGreen",
      light: "lightGreen"
    },
    diffRemoved: {
      dark: "darkRed",
      light: "lightRed"
    },
    diffContext: {
      dark: "darkMuted",
      light: "lightMuted"
    },
    diffHunkHeader: {
      dark: "darkMuted",
      light: "lightMuted"
    },
    diffHighlightAdded: {
      dark: "darkGreenBright",
      light: "lightGreenBright"
    },
    diffHighlightRemoved: {
      dark: "darkRedBright",
      light: "lightRedBright"
    },
    diffAddedBg: {
      dark: "#3fa26633",
      light: "#1f8a651f"
    },
    diffRemovedBg: {
      dark: "#b8004933",
      light: "#cf2d5614"
    },
    diffContextBg: {
      dark: "darkPanel",
      light: "lightPanel"
    },
    diffLineNumber: {
      dark: "#eeeeee87",
      light: "textMuted"
    },
    diffAddedLineNumberBg: {
      dark: "#3fa26633",
      light: "#1f8a651f"
    },
    diffRemovedLineNumberBg: {
      dark: "#b8004933",
      light: "#cf2d5614"
    },
    markdownText: {
      dark: "darkFg",
      light: "lightFg"
    },
    markdownHeading: {
      dark: "darkPurple",
      light: "lightBlueDark"
    },
    markdownLink: {
      dark: "darkTeal",
      light: "lightBlueDark"
    },
    markdownLinkText: {
      dark: "darkBlue",
      light: "lightMuted"
    },
    markdownCode: {
      dark: "darkPink",
      light: "lightGreen"
    },
    markdownBlockQuote: {
      dark: "darkMuted",
      light: "lightMuted"
    },
    markdownEmph: {
      dark: "darkTeal",
      light: "lightFg"
    },
    markdownStrong: {
      dark: "darkSyntaxYellow",
      light: "lightFg"
    },
    markdownHorizontalRule: {
      dark: "darkMuted",
      light: "lightMuted"
    },
    markdownListItem: {
      dark: "darkFg",
      light: "lightFg"
    },
    markdownListEnumeration: {
      dark: "darkCyan",
      light: "lightMuted"
    },
    markdownImage: {
      dark: "darkCyan",
      light: "lightBlueDark"
    },
    markdownImageText: {
      dark: "darkBlue",
      light: "lightMuted"
    },
    markdownCodeBlock: {
      dark: "darkFg",
      light: "lightFg"
    },
    syntaxComment: {
      dark: "darkMuted",
      light: "lightMuted"
    },
    syntaxKeyword: {
      dark: "darkTeal",
      light: "lightMagenta"
    },
    syntaxFunction: {
      dark: "darkSyntaxOrange",
      light: "lightOrange"
    },
    syntaxVariable: {
      dark: "darkFg",
      light: "lightFg"
    },
    syntaxString: {
      dark: "darkPink",
      light: "lightPurple"
    },
    syntaxNumber: {
      dark: "darkSyntaxYellow",
      light: "lightPink"
    },
    syntaxType: {
      dark: "darkSyntaxOrange",
      light: "lightBlueDark"
    },
    syntaxOperator: {
      dark: "darkFg",
      light: "lightFg"
    },
    syntaxPunctuation: {
      dark: "darkFg",
      light: "lightFg"
    }
  }
};
// ../tui-base/src/theme/assets/dracula.json
var dracula_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    background: "#282a36",
    currentLine: "#44475a",
    selection: "#44475a",
    foreground: "#f8f8f2",
    comment: "#6272a4",
    cyan: "#8be9fd",
    green: "#50fa7b",
    orange: "#ffb86c",
    pink: "#ff79c6",
    purple: "#bd93f9",
    red: "#ff5555",
    yellow: "#f1fa8c"
  },
  theme: {
    primary: {
      dark: "purple",
      light: "purple"
    },
    secondary: {
      dark: "pink",
      light: "pink"
    },
    accent: {
      dark: "cyan",
      light: "cyan"
    },
    error: {
      dark: "red",
      light: "red"
    },
    warning: {
      dark: "yellow",
      light: "yellow"
    },
    success: {
      dark: "green",
      light: "green"
    },
    info: {
      dark: "orange",
      light: "orange"
    },
    text: {
      dark: "foreground",
      light: "#282a36"
    },
    textMuted: {
      dark: "comment",
      light: "#6272a4"
    },
    background: {
      dark: "#282a36",
      light: "#f8f8f2"
    },
    backgroundPanel: {
      dark: "#21222c",
      light: "#e8e8e2"
    },
    backgroundElement: {
      dark: "currentLine",
      light: "#d8d8d2"
    },
    border: {
      dark: "currentLine",
      light: "#c8c8c2"
    },
    borderActive: {
      dark: "purple",
      light: "purple"
    },
    borderSubtle: {
      dark: "#191a21",
      light: "#e0e0e0"
    },
    diffAdded: {
      dark: "green",
      light: "green"
    },
    diffRemoved: {
      dark: "red",
      light: "red"
    },
    diffContext: {
      dark: "comment",
      light: "#6272a4"
    },
    diffHunkHeader: {
      dark: "comment",
      light: "#6272a4"
    },
    diffHighlightAdded: {
      dark: "green",
      light: "green"
    },
    diffHighlightRemoved: {
      dark: "red",
      light: "red"
    },
    diffAddedBg: {
      dark: "#1a3a1a",
      light: "#e0ffe0"
    },
    diffRemovedBg: {
      dark: "#3a1a1a",
      light: "#ffe0e0"
    },
    diffContextBg: {
      dark: "#21222c",
      light: "#e8e8e2"
    },
    diffLineNumber: {
      dark: "#989aa4",
      light: "#686865"
    },
    diffAddedLineNumberBg: {
      dark: "#1a3a1a",
      light: "#e0ffe0"
    },
    diffRemovedLineNumberBg: {
      dark: "#3a1a1a",
      light: "#ffe0e0"
    },
    markdownText: {
      dark: "foreground",
      light: "#282a36"
    },
    markdownHeading: {
      dark: "purple",
      light: "purple"
    },
    markdownLink: {
      dark: "cyan",
      light: "cyan"
    },
    markdownLinkText: {
      dark: "pink",
      light: "pink"
    },
    markdownCode: {
      dark: "green",
      light: "green"
    },
    markdownBlockQuote: {
      dark: "comment",
      light: "#6272a4"
    },
    markdownEmph: {
      dark: "yellow",
      light: "yellow"
    },
    markdownStrong: {
      dark: "orange",
      light: "orange"
    },
    markdownHorizontalRule: {
      dark: "comment",
      light: "#6272a4"
    },
    markdownListItem: {
      dark: "purple",
      light: "purple"
    },
    markdownListEnumeration: {
      dark: "cyan",
      light: "cyan"
    },
    markdownImage: {
      dark: "cyan",
      light: "cyan"
    },
    markdownImageText: {
      dark: "pink",
      light: "pink"
    },
    markdownCodeBlock: {
      dark: "foreground",
      light: "#282a36"
    },
    syntaxComment: {
      dark: "comment",
      light: "#6272a4"
    },
    syntaxKeyword: {
      dark: "pink",
      light: "pink"
    },
    syntaxFunction: {
      dark: "green",
      light: "green"
    },
    syntaxVariable: {
      dark: "foreground",
      light: "#282a36"
    },
    syntaxString: {
      dark: "yellow",
      light: "yellow"
    },
    syntaxNumber: {
      dark: "purple",
      light: "purple"
    },
    syntaxType: {
      dark: "cyan",
      light: "cyan"
    },
    syntaxOperator: {
      dark: "pink",
      light: "pink"
    },
    syntaxPunctuation: {
      dark: "foreground",
      light: "#282a36"
    }
  }
};
// ../tui-base/src/theme/assets/everforest.json
var everforest_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    darkStep1: "#2d353b",
    darkStep2: "#333c43",
    darkStep3: "#343f44",
    darkStep4: "#3d484d",
    darkStep5: "#475258",
    darkStep6: "#7a8478",
    darkStep7: "#859289",
    darkStep8: "#9da9a0",
    darkStep9: "#a7c080",
    darkStep10: "#83c092",
    darkStep11: "#7a8478",
    darkStep12: "#d3c6aa",
    darkRed: "#e67e80",
    darkOrange: "#e69875",
    darkGreen: "#a7c080",
    darkCyan: "#83c092",
    darkYellow: "#dbbc7f",
    lightStep1: "#fdf6e3",
    lightStep2: "#efebd4",
    lightStep3: "#f4f0d9",
    lightStep4: "#efebd4",
    lightStep5: "#e6e2cc",
    lightStep6: "#a6b0a0",
    lightStep7: "#939f91",
    lightStep8: "#829181",
    lightStep9: "#8da101",
    lightStep10: "#35a77c",
    lightStep11: "#a6b0a0",
    lightStep12: "#5c6a72",
    lightRed: "#f85552",
    lightOrange: "#f57d26",
    lightGreen: "#8da101",
    lightCyan: "#35a77c",
    lightYellow: "#dfa000"
  },
  theme: {
    primary: {
      dark: "darkStep9",
      light: "lightStep9"
    },
    secondary: {
      dark: "#7fbbb3",
      light: "#3a94c5"
    },
    accent: {
      dark: "#d699b6",
      light: "#df69ba"
    },
    error: {
      dark: "darkRed",
      light: "lightRed"
    },
    warning: {
      dark: "darkOrange",
      light: "lightOrange"
    },
    success: {
      dark: "darkGreen",
      light: "lightGreen"
    },
    info: {
      dark: "darkCyan",
      light: "lightCyan"
    },
    text: {
      dark: "darkStep12",
      light: "lightStep12"
    },
    textMuted: {
      dark: "darkStep11",
      light: "lightStep11"
    },
    background: {
      dark: "darkStep1",
      light: "lightStep1"
    },
    backgroundPanel: {
      dark: "darkStep2",
      light: "lightStep2"
    },
    backgroundElement: {
      dark: "darkStep3",
      light: "lightStep3"
    },
    border: {
      dark: "darkStep7",
      light: "lightStep7"
    },
    borderActive: {
      dark: "darkStep8",
      light: "lightStep8"
    },
    borderSubtle: {
      dark: "darkStep6",
      light: "lightStep6"
    },
    diffAdded: {
      dark: "#4fd6be",
      light: "#1e725c"
    },
    diffRemoved: {
      dark: "#c53b53",
      light: "#c53b53"
    },
    diffContext: {
      dark: "#828bb8",
      light: "#7086b5"
    },
    diffHunkHeader: {
      dark: "#828bb8",
      light: "#7086b5"
    },
    diffHighlightAdded: {
      dark: "#b8db87",
      light: "#4db380"
    },
    diffHighlightRemoved: {
      dark: "#e26a75",
      light: "#f52a65"
    },
    diffAddedBg: {
      dark: "#20303b",
      light: "#d5e5d5"
    },
    diffRemovedBg: {
      dark: "#37222c",
      light: "#f7d8db"
    },
    diffContextBg: {
      dark: "darkStep2",
      light: "lightStep2"
    },
    diffLineNumber: {
      dark: "#a0a5a7",
      light: "#5b5951"
    },
    diffAddedLineNumberBg: {
      dark: "#1b2b34",
      light: "#c5d5c5"
    },
    diffRemovedLineNumberBg: {
      dark: "#2d1f26",
      light: "#e7c8cb"
    },
    markdownText: {
      dark: "darkStep12",
      light: "lightStep12"
    },
    markdownHeading: {
      dark: "#d699b6",
      light: "#df69ba"
    },
    markdownLink: {
      dark: "darkStep9",
      light: "lightStep9"
    },
    markdownLinkText: {
      dark: "darkCyan",
      light: "lightCyan"
    },
    markdownCode: {
      dark: "darkGreen",
      light: "lightGreen"
    },
    markdownBlockQuote: {
      dark: "darkYellow",
      light: "lightYellow"
    },
    markdownEmph: {
      dark: "darkYellow",
      light: "lightYellow"
    },
    markdownStrong: {
      dark: "darkOrange",
      light: "lightOrange"
    },
    markdownHorizontalRule: {
      dark: "darkStep11",
      light: "lightStep11"
    },
    markdownListItem: {
      dark: "darkStep9",
      light: "lightStep9"
    },
    markdownListEnumeration: {
      dark: "darkCyan",
      light: "lightCyan"
    },
    markdownImage: {
      dark: "darkStep9",
      light: "lightStep9"
    },
    markdownImageText: {
      dark: "darkCyan",
      light: "lightCyan"
    },
    markdownCodeBlock: {
      dark: "darkStep12",
      light: "lightStep12"
    },
    syntaxComment: {
      dark: "darkStep11",
      light: "lightStep11"
    },
    syntaxKeyword: {
      dark: "#d699b6",
      light: "#df69ba"
    },
    syntaxFunction: {
      dark: "darkStep9",
      light: "lightStep9"
    },
    syntaxVariable: {
      dark: "darkRed",
      light: "lightRed"
    },
    syntaxString: {
      dark: "darkGreen",
      light: "lightGreen"
    },
    syntaxNumber: {
      dark: "darkOrange",
      light: "lightOrange"
    },
    syntaxType: {
      dark: "darkYellow",
      light: "lightYellow"
    },
    syntaxOperator: {
      dark: "darkCyan",
      light: "lightCyan"
    },
    syntaxPunctuation: {
      dark: "darkStep12",
      light: "lightStep12"
    }
  }
};
// ../tui-base/src/theme/assets/flexoki.json
var flexoki_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    black: "#100F0F",
    base950: "#1C1B1A",
    base900: "#282726",
    base850: "#343331",
    base800: "#403E3C",
    base700: "#575653",
    base600: "#6F6E69",
    base500: "#878580",
    base300: "#B7B5AC",
    base200: "#CECDC3",
    base150: "#DAD8CE",
    base100: "#E6E4D9",
    base50: "#F2F0E5",
    paper: "#FFFCF0",
    red400: "#D14D41",
    red600: "#AF3029",
    orange400: "#DA702C",
    orange600: "#BC5215",
    yellow400: "#D0A215",
    yellow600: "#AD8301",
    green400: "#879A39",
    green600: "#66800B",
    cyan400: "#3AA99F",
    cyan600: "#24837B",
    blue400: "#4385BE",
    blue600: "#205EA6",
    purple400: "#8B7EC8",
    purple600: "#5E409D",
    magenta400: "#CE5D97",
    magenta600: "#A02F6F"
  },
  theme: {
    primary: {
      dark: "orange400",
      light: "blue600"
    },
    secondary: {
      dark: "blue400",
      light: "purple600"
    },
    accent: {
      dark: "purple400",
      light: "orange600"
    },
    error: {
      dark: "red400",
      light: "red600"
    },
    warning: {
      dark: "orange400",
      light: "orange600"
    },
    success: {
      dark: "green400",
      light: "green600"
    },
    info: {
      dark: "cyan400",
      light: "cyan600"
    },
    text: {
      dark: "base200",
      light: "black"
    },
    textMuted: {
      dark: "base600",
      light: "base600"
    },
    background: {
      dark: "black",
      light: "paper"
    },
    backgroundPanel: {
      dark: "base950",
      light: "base50"
    },
    backgroundElement: {
      dark: "base900",
      light: "base100"
    },
    border: {
      dark: "base700",
      light: "base300"
    },
    borderActive: {
      dark: "base600",
      light: "base500"
    },
    borderSubtle: {
      dark: "base800",
      light: "base200"
    },
    diffAdded: {
      dark: "green400",
      light: "green600"
    },
    diffRemoved: {
      dark: "red400",
      light: "red600"
    },
    diffContext: {
      dark: "base600",
      light: "base600"
    },
    diffHunkHeader: {
      dark: "blue400",
      light: "blue600"
    },
    diffHighlightAdded: {
      dark: "green400",
      light: "green600"
    },
    diffHighlightRemoved: {
      dark: "red400",
      light: "red600"
    },
    diffAddedBg: {
      dark: "#1A2D1A",
      light: "#D5E5D5"
    },
    diffRemovedBg: {
      dark: "#2D1A1A",
      light: "#F7D8DB"
    },
    diffContextBg: {
      dark: "base950",
      light: "base50"
    },
    diffLineNumber: {
      dark: "#888883",
      light: "#5a5955"
    },
    diffAddedLineNumberBg: {
      dark: "#152515",
      light: "#C5D5C5"
    },
    diffRemovedLineNumberBg: {
      dark: "#251515",
      light: "#E7C8CB"
    },
    markdownText: {
      dark: "base200",
      light: "black"
    },
    markdownHeading: {
      dark: "purple400",
      light: "purple600"
    },
    markdownLink: {
      dark: "blue400",
      light: "blue600"
    },
    markdownLinkText: {
      dark: "cyan400",
      light: "cyan600"
    },
    markdownCode: {
      dark: "cyan400",
      light: "cyan600"
    },
    markdownBlockQuote: {
      dark: "yellow400",
      light: "yellow600"
    },
    markdownEmph: {
      dark: "yellow400",
      light: "yellow600"
    },
    markdownStrong: {
      dark: "orange400",
      light: "orange600"
    },
    markdownHorizontalRule: {
      dark: "base600",
      light: "base600"
    },
    markdownListItem: {
      dark: "orange400",
      light: "orange600"
    },
    markdownListEnumeration: {
      dark: "cyan400",
      light: "cyan600"
    },
    markdownImage: {
      dark: "magenta400",
      light: "magenta600"
    },
    markdownImageText: {
      dark: "cyan400",
      light: "cyan600"
    },
    markdownCodeBlock: {
      dark: "base200",
      light: "black"
    },
    syntaxComment: {
      dark: "base600",
      light: "base600"
    },
    syntaxKeyword: {
      dark: "green400",
      light: "green600"
    },
    syntaxFunction: {
      dark: "orange400",
      light: "orange600"
    },
    syntaxVariable: {
      dark: "blue400",
      light: "blue600"
    },
    syntaxString: {
      dark: "cyan400",
      light: "cyan600"
    },
    syntaxNumber: {
      dark: "purple400",
      light: "purple600"
    },
    syntaxType: {
      dark: "yellow400",
      light: "yellow600"
    },
    syntaxOperator: {
      dark: "base300",
      light: "base600"
    },
    syntaxPunctuation: {
      dark: "base300",
      light: "base600"
    }
  }
};
// ../tui-base/src/theme/assets/github.json
var github_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    darkBg: "#0d1117",
    darkBgAlt: "#010409",
    darkBgPanel: "#161b22",
    darkFg: "#c9d1d9",
    darkFgMuted: "#8b949e",
    darkBlue: "#58a6ff",
    darkGreen: "#3fb950",
    darkRed: "#f85149",
    darkOrange: "#d29922",
    darkPurple: "#bc8cff",
    darkPink: "#ff7b72",
    darkYellow: "#e3b341",
    darkCyan: "#39c5cf",
    lightBg: "#ffffff",
    lightBgAlt: "#f6f8fa",
    lightBgPanel: "#f0f3f6",
    lightFg: "#24292f",
    lightFgMuted: "#57606a",
    lightBlue: "#0969da",
    lightGreen: "#1a7f37",
    lightRed: "#cf222e",
    lightOrange: "#bc4c00",
    lightPurple: "#8250df",
    lightPink: "#bf3989",
    lightYellow: "#9a6700",
    lightCyan: "#1b7c83"
  },
  theme: {
    primary: {
      dark: "darkBlue",
      light: "lightBlue"
    },
    secondary: {
      dark: "darkPurple",
      light: "lightPurple"
    },
    accent: {
      dark: "darkCyan",
      light: "lightCyan"
    },
    error: {
      dark: "darkRed",
      light: "lightRed"
    },
    warning: {
      dark: "darkYellow",
      light: "lightYellow"
    },
    success: {
      dark: "darkGreen",
      light: "lightGreen"
    },
    info: {
      dark: "darkOrange",
      light: "lightOrange"
    },
    text: {
      dark: "darkFg",
      light: "lightFg"
    },
    textMuted: {
      dark: "darkFgMuted",
      light: "lightFgMuted"
    },
    background: {
      dark: "darkBg",
      light: "lightBg"
    },
    backgroundPanel: {
      dark: "darkBgAlt",
      light: "lightBgAlt"
    },
    backgroundElement: {
      dark: "darkBgPanel",
      light: "lightBgPanel"
    },
    border: {
      dark: "#30363d",
      light: "#d0d7de"
    },
    borderActive: {
      dark: "darkBlue",
      light: "lightBlue"
    },
    borderSubtle: {
      dark: "#21262d",
      light: "#d8dee4"
    },
    diffAdded: {
      dark: "darkGreen",
      light: "lightGreen"
    },
    diffRemoved: {
      dark: "darkRed",
      light: "lightRed"
    },
    diffContext: {
      dark: "darkFgMuted",
      light: "lightFgMuted"
    },
    diffHunkHeader: {
      dark: "darkBlue",
      light: "lightBlue"
    },
    diffHighlightAdded: {
      dark: "#3fb950",
      light: "#1a7f37"
    },
    diffHighlightRemoved: {
      dark: "#f85149",
      light: "#cf222e"
    },
    diffAddedBg: {
      dark: "#033a16",
      light: "#dafbe1"
    },
    diffRemovedBg: {
      dark: "#67060c",
      light: "#ffebe9"
    },
    diffContextBg: {
      dark: "darkBgAlt",
      light: "lightBgAlt"
    },
    diffLineNumber: {
      dark: "#95999e",
      light: "textMuted"
    },
    diffAddedLineNumberBg: {
      dark: "#033a16",
      light: "#dafbe1"
    },
    diffRemovedLineNumberBg: {
      dark: "#67060c",
      light: "#ffebe9"
    },
    markdownText: {
      dark: "darkFg",
      light: "lightFg"
    },
    markdownHeading: {
      dark: "darkBlue",
      light: "lightBlue"
    },
    markdownLink: {
      dark: "darkBlue",
      light: "lightBlue"
    },
    markdownLinkText: {
      dark: "darkCyan",
      light: "lightCyan"
    },
    markdownCode: {
      dark: "darkPink",
      light: "lightPink"
    },
    markdownBlockQuote: {
      dark: "darkFgMuted",
      light: "lightFgMuted"
    },
    markdownEmph: {
      dark: "darkYellow",
      light: "lightYellow"
    },
    markdownStrong: {
      dark: "darkOrange",
      light: "lightOrange"
    },
    markdownHorizontalRule: {
      dark: "#30363d",
      light: "#d0d7de"
    },
    markdownListItem: {
      dark: "darkBlue",
      light: "lightBlue"
    },
    markdownListEnumeration: {
      dark: "darkCyan",
      light: "lightCyan"
    },
    markdownImage: {
      dark: "darkBlue",
      light: "lightBlue"
    },
    markdownImageText: {
      dark: "darkCyan",
      light: "lightCyan"
    },
    markdownCodeBlock: {
      dark: "darkFg",
      light: "lightFg"
    },
    syntaxComment: {
      dark: "darkFgMuted",
      light: "lightFgMuted"
    },
    syntaxKeyword: {
      dark: "darkPink",
      light: "lightRed"
    },
    syntaxFunction: {
      dark: "darkPurple",
      light: "lightPurple"
    },
    syntaxVariable: {
      dark: "darkOrange",
      light: "lightOrange"
    },
    syntaxString: {
      dark: "darkCyan",
      light: "lightBlue"
    },
    syntaxNumber: {
      dark: "darkBlue",
      light: "lightCyan"
    },
    syntaxType: {
      dark: "darkOrange",
      light: "lightOrange"
    },
    syntaxOperator: {
      dark: "darkPink",
      light: "lightRed"
    },
    syntaxPunctuation: {
      dark: "darkFg",
      light: "lightFg"
    }
  }
};
// ../tui-base/src/theme/assets/gruvbox.json
var gruvbox_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    darkBg0: "#282828",
    darkBg1: "#3c3836",
    darkBg2: "#504945",
    darkBg3: "#665c54",
    darkFg0: "#fbf1c7",
    darkFg1: "#ebdbb2",
    darkGray: "#928374",
    darkRed: "#cc241d",
    darkGreen: "#98971a",
    darkYellow: "#d79921",
    darkBlue: "#458588",
    darkPurple: "#b16286",
    darkAqua: "#689d6a",
    darkOrange: "#d65d0e",
    darkRedBright: "#fb4934",
    darkGreenBright: "#b8bb26",
    darkYellowBright: "#fabd2f",
    darkBlueBright: "#83a598",
    darkPurpleBright: "#d3869b",
    darkAquaBright: "#8ec07c",
    darkOrangeBright: "#fe8019",
    lightBg0: "#fbf1c7",
    lightBg1: "#ebdbb2",
    lightBg2: "#d5c4a1",
    lightBg3: "#bdae93",
    lightFg0: "#282828",
    lightFg1: "#3c3836",
    lightGray: "#7c6f64",
    lightRed: "#9d0006",
    lightGreen: "#79740e",
    lightYellow: "#b57614",
    lightBlue: "#076678",
    lightPurple: "#8f3f71",
    lightAqua: "#427b58",
    lightOrange: "#af3a03"
  },
  theme: {
    primary: {
      dark: "darkBlueBright",
      light: "lightBlue"
    },
    secondary: {
      dark: "darkPurpleBright",
      light: "lightPurple"
    },
    accent: {
      dark: "darkAquaBright",
      light: "lightAqua"
    },
    error: {
      dark: "darkRedBright",
      light: "lightRed"
    },
    warning: {
      dark: "darkOrangeBright",
      light: "lightOrange"
    },
    success: {
      dark: "darkGreenBright",
      light: "lightGreen"
    },
    info: {
      dark: "darkYellowBright",
      light: "lightYellow"
    },
    text: {
      dark: "darkFg1",
      light: "lightFg1"
    },
    textMuted: {
      dark: "darkGray",
      light: "lightGray"
    },
    background: {
      dark: "darkBg0",
      light: "lightBg0"
    },
    backgroundPanel: {
      dark: "darkBg1",
      light: "lightBg1"
    },
    backgroundElement: {
      dark: "darkBg2",
      light: "lightBg2"
    },
    border: {
      dark: "darkBg3",
      light: "lightBg3"
    },
    borderActive: {
      dark: "darkFg1",
      light: "lightFg1"
    },
    borderSubtle: {
      dark: "darkBg2",
      light: "lightBg2"
    },
    diffAdded: {
      dark: "darkGreen",
      light: "lightGreen"
    },
    diffRemoved: {
      dark: "darkRed",
      light: "lightRed"
    },
    diffContext: {
      dark: "darkGray",
      light: "lightGray"
    },
    diffHunkHeader: {
      dark: "darkAqua",
      light: "lightAqua"
    },
    diffHighlightAdded: {
      dark: "darkGreenBright",
      light: "lightGreen"
    },
    diffHighlightRemoved: {
      dark: "darkRedBright",
      light: "lightRed"
    },
    diffAddedBg: {
      dark: "#32302f",
      light: "#dcd8a4"
    },
    diffRemovedBg: {
      dark: "#322929",
      light: "#e2c7c3"
    },
    diffContextBg: {
      dark: "darkBg1",
      light: "lightBg1"
    },
    diffLineNumber: {
      dark: "#a8a29e",
      light: "#564f43"
    },
    diffAddedLineNumberBg: {
      dark: "#2a2827",
      light: "#cec99e"
    },
    diffRemovedLineNumberBg: {
      dark: "#2a2222",
      light: "#d3bdb9"
    },
    markdownText: {
      dark: "darkFg1",
      light: "lightFg1"
    },
    markdownHeading: {
      dark: "darkBlueBright",
      light: "lightBlue"
    },
    markdownLink: {
      dark: "darkAquaBright",
      light: "lightAqua"
    },
    markdownLinkText: {
      dark: "darkGreenBright",
      light: "lightGreen"
    },
    markdownCode: {
      dark: "darkYellowBright",
      light: "lightYellow"
    },
    markdownBlockQuote: {
      dark: "darkGray",
      light: "lightGray"
    },
    markdownEmph: {
      dark: "darkPurpleBright",
      light: "lightPurple"
    },
    markdownStrong: {
      dark: "darkOrangeBright",
      light: "lightOrange"
    },
    markdownHorizontalRule: {
      dark: "darkGray",
      light: "lightGray"
    },
    markdownListItem: {
      dark: "darkBlueBright",
      light: "lightBlue"
    },
    markdownListEnumeration: {
      dark: "darkAquaBright",
      light: "lightAqua"
    },
    markdownImage: {
      dark: "darkAquaBright",
      light: "lightAqua"
    },
    markdownImageText: {
      dark: "darkGreenBright",
      light: "lightGreen"
    },
    markdownCodeBlock: {
      dark: "darkFg1",
      light: "lightFg1"
    },
    syntaxComment: {
      dark: "darkGray",
      light: "lightGray"
    },
    syntaxKeyword: {
      dark: "darkRedBright",
      light: "lightRed"
    },
    syntaxFunction: {
      dark: "darkGreenBright",
      light: "lightGreen"
    },
    syntaxVariable: {
      dark: "darkBlueBright",
      light: "lightBlue"
    },
    syntaxString: {
      dark: "darkYellowBright",
      light: "lightYellow"
    },
    syntaxNumber: {
      dark: "darkPurpleBright",
      light: "lightPurple"
    },
    syntaxType: {
      dark: "darkAquaBright",
      light: "lightAqua"
    },
    syntaxOperator: {
      dark: "darkOrangeBright",
      light: "lightOrange"
    },
    syntaxPunctuation: {
      dark: "darkFg1",
      light: "lightFg1"
    }
  }
};
// ../tui-base/src/theme/assets/kanagawa.json
var kanagawa_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    sumiInk0: "#1F1F28",
    sumiInk1: "#2A2A37",
    sumiInk2: "#363646",
    sumiInk3: "#54546D",
    fujiWhite: "#DCD7BA",
    oldWhite: "#C8C093",
    fujiGray: "#727169",
    oniViolet: "#957FB8",
    crystalBlue: "#7E9CD8",
    carpYellow: "#C38D9D",
    sakuraPink: "#D27E99",
    waveAqua: "#76946A",
    roninYellow: "#D7A657",
    dragonRed: "#E82424",
    lotusGreen: "#98BB6C",
    waveBlue: "#2D4F67",
    lightBg: "#F2E9DE",
    lightPaper: "#EAE4D7",
    lightText: "#54433A",
    lightGray: "#9E9389"
  },
  theme: {
    primary: { dark: "crystalBlue", light: "waveBlue" },
    secondary: { dark: "oniViolet", light: "oniViolet" },
    accent: { dark: "sakuraPink", light: "sakuraPink" },
    error: { dark: "dragonRed", light: "dragonRed" },
    warning: { dark: "roninYellow", light: "roninYellow" },
    success: { dark: "lotusGreen", light: "lotusGreen" },
    info: { dark: "waveAqua", light: "waveAqua" },
    text: { dark: "fujiWhite", light: "lightText" },
    textMuted: { dark: "fujiGray", light: "lightGray" },
    background: { dark: "sumiInk0", light: "lightBg" },
    backgroundPanel: { dark: "sumiInk1", light: "lightPaper" },
    backgroundElement: { dark: "sumiInk2", light: "#E3DCD2" },
    border: { dark: "sumiInk3", light: "#D4CBBF" },
    borderActive: { dark: "carpYellow", light: "carpYellow" },
    borderSubtle: { dark: "sumiInk2", light: "#DCD4C9" },
    diffAdded: { dark: "lotusGreen", light: "lotusGreen" },
    diffRemoved: { dark: "dragonRed", light: "dragonRed" },
    diffContext: { dark: "fujiGray", light: "lightGray" },
    diffHunkHeader: { dark: "waveBlue", light: "waveBlue" },
    diffHighlightAdded: { dark: "#A9D977", light: "#89AF5B" },
    diffHighlightRemoved: { dark: "#F24A4A", light: "#D61F1F" },
    diffAddedBg: { dark: "#252E25", light: "#EAF3E4" },
    diffRemovedBg: { dark: "#362020", light: "#FBE6E6" },
    diffContextBg: { dark: "sumiInk1", light: "lightPaper" },
    diffLineNumber: { dark: "#9090a0", light: "#65615c" },
    diffAddedLineNumberBg: { dark: "#202820", light: "#DDE8D6" },
    diffRemovedLineNumberBg: { dark: "#2D1C1C", light: "#F2DADA" },
    markdownText: { dark: "fujiWhite", light: "lightText" },
    markdownHeading: { dark: "oniViolet", light: "oniViolet" },
    markdownLink: { dark: "crystalBlue", light: "waveBlue" },
    markdownLinkText: { dark: "waveAqua", light: "waveAqua" },
    markdownCode: { dark: "lotusGreen", light: "lotusGreen" },
    markdownBlockQuote: { dark: "fujiGray", light: "lightGray" },
    markdownEmph: { dark: "carpYellow", light: "carpYellow" },
    markdownStrong: { dark: "roninYellow", light: "roninYellow" },
    markdownHorizontalRule: { dark: "fujiGray", light: "lightGray" },
    markdownListItem: { dark: "crystalBlue", light: "waveBlue" },
    markdownListEnumeration: { dark: "waveAqua", light: "waveAqua" },
    markdownImage: { dark: "crystalBlue", light: "waveBlue" },
    markdownImageText: { dark: "waveAqua", light: "waveAqua" },
    markdownCodeBlock: { dark: "fujiWhite", light: "lightText" },
    syntaxComment: { dark: "fujiGray", light: "lightGray" },
    syntaxKeyword: { dark: "oniViolet", light: "oniViolet" },
    syntaxFunction: { dark: "crystalBlue", light: "waveBlue" },
    syntaxVariable: { dark: "fujiWhite", light: "lightText" },
    syntaxString: { dark: "lotusGreen", light: "lotusGreen" },
    syntaxNumber: { dark: "roninYellow", light: "roninYellow" },
    syntaxType: { dark: "carpYellow", light: "carpYellow" },
    syntaxOperator: { dark: "sakuraPink", light: "sakuraPink" },
    syntaxPunctuation: { dark: "fujiWhite", light: "lightText" }
  }
};
// ../tui-base/src/theme/assets/lucent-orng.json
var lucent_orng_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    darkStep6: "#3c3c3c",
    darkStep11: "#808080",
    darkStep12: "#eeeeee",
    darkSecondary: "#EE7948",
    darkAccent: "#FFF7F1",
    darkRed: "#e06c75",
    darkOrange: "#EC5B2B",
    darkBlue: "#6ba1e6",
    darkCyan: "#56b6c2",
    darkYellow: "#e5c07b",
    darkPanelBg: "#2a1a1599",
    lightStep6: "#d4d4d4",
    lightStep11: "#8a8a8a",
    lightStep12: "#1a1a1a",
    lightSecondary: "#EE7948",
    lightAccent: "#c94d24",
    lightRed: "#d1383d",
    lightOrange: "#EC5B2B",
    lightBlue: "#0062d1",
    lightCyan: "#318795",
    lightYellow: "#b0851f",
    lightPanelBg: "#fff5f099"
  },
  theme: {
    primary: {
      dark: "darkOrange",
      light: "lightOrange"
    },
    secondary: {
      dark: "darkSecondary",
      light: "lightSecondary"
    },
    accent: {
      dark: "darkAccent",
      light: "lightAccent"
    },
    error: {
      dark: "darkRed",
      light: "lightRed"
    },
    warning: {
      dark: "darkOrange",
      light: "lightOrange"
    },
    success: {
      dark: "darkBlue",
      light: "lightBlue"
    },
    info: {
      dark: "darkCyan",
      light: "lightCyan"
    },
    text: {
      dark: "darkStep12",
      light: "lightStep12"
    },
    textMuted: {
      dark: "darkStep11",
      light: "lightStep11"
    },
    selectedListItemText: {
      dark: "#0a0a0a",
      light: "#ffffff"
    },
    background: {
      dark: "transparent",
      light: "transparent"
    },
    backgroundPanel: {
      dark: "transparent",
      light: "transparent"
    },
    backgroundElement: {
      dark: "transparent",
      light: "transparent"
    },
    backgroundMenu: {
      dark: "darkPanelBg",
      light: "lightPanelBg"
    },
    border: {
      dark: "darkOrange",
      light: "lightOrange"
    },
    borderActive: {
      dark: "darkSecondary",
      light: "lightAccent"
    },
    borderSubtle: {
      dark: "darkStep6",
      light: "lightStep6"
    },
    diffAdded: {
      dark: "darkBlue",
      light: "lightBlue"
    },
    diffRemoved: {
      dark: "#c53b53",
      light: "#c53b53"
    },
    diffContext: {
      dark: "#828bb8",
      light: "#7086b5"
    },
    diffHunkHeader: {
      dark: "#828bb8",
      light: "#7086b5"
    },
    diffHighlightAdded: {
      dark: "darkBlue",
      light: "lightBlue"
    },
    diffHighlightRemoved: {
      dark: "#e26a75",
      light: "#f52a65"
    },
    diffAddedBg: {
      dark: "transparent",
      light: "transparent"
    },
    diffRemovedBg: {
      dark: "transparent",
      light: "transparent"
    },
    diffContextBg: {
      dark: "transparent",
      light: "transparent"
    },
    diffLineNumber: "textMuted",
    diffAddedLineNumberBg: {
      dark: "transparent",
      light: "transparent"
    },
    diffRemovedLineNumberBg: {
      dark: "transparent",
      light: "transparent"
    },
    markdownText: {
      dark: "darkStep12",
      light: "lightStep12"
    },
    markdownHeading: {
      dark: "darkOrange",
      light: "lightOrange"
    },
    markdownLink: {
      dark: "darkOrange",
      light: "lightOrange"
    },
    markdownLinkText: {
      dark: "darkCyan",
      light: "lightCyan"
    },
    markdownCode: {
      dark: "darkBlue",
      light: "lightBlue"
    },
    markdownBlockQuote: {
      dark: "darkAccent",
      light: "lightYellow"
    },
    markdownEmph: {
      dark: "darkYellow",
      light: "lightYellow"
    },
    markdownStrong: {
      dark: "darkSecondary",
      light: "lightOrange"
    },
    markdownHorizontalRule: {
      dark: "darkStep11",
      light: "lightStep11"
    },
    markdownListItem: {
      dark: "darkOrange",
      light: "lightOrange"
    },
    markdownListEnumeration: {
      dark: "darkCyan",
      light: "lightCyan"
    },
    markdownImage: {
      dark: "darkOrange",
      light: "lightOrange"
    },
    markdownImageText: {
      dark: "darkCyan",
      light: "lightCyan"
    },
    markdownCodeBlock: {
      dark: "darkStep12",
      light: "lightStep12"
    },
    syntaxComment: {
      dark: "darkStep11",
      light: "lightStep11"
    },
    syntaxKeyword: {
      dark: "darkOrange",
      light: "lightOrange"
    },
    syntaxFunction: {
      dark: "darkSecondary",
      light: "lightAccent"
    },
    syntaxVariable: {
      dark: "darkRed",
      light: "lightRed"
    },
    syntaxString: {
      dark: "darkBlue",
      light: "lightBlue"
    },
    syntaxNumber: {
      dark: "darkAccent",
      light: "lightOrange"
    },
    syntaxType: {
      dark: "darkYellow",
      light: "lightYellow"
    },
    syntaxOperator: {
      dark: "darkCyan",
      light: "lightCyan"
    },
    syntaxPunctuation: {
      dark: "darkStep12",
      light: "lightStep12"
    }
  }
};
// ../tui-base/src/theme/assets/material.json
var material_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    darkBg: "#263238",
    darkBgAlt: "#1e272c",
    darkBgPanel: "#37474f",
    darkFg: "#eeffff",
    darkFgMuted: "#546e7a",
    darkRed: "#f07178",
    darkPink: "#f78c6c",
    darkOrange: "#ffcb6b",
    darkYellow: "#ffcb6b",
    darkGreen: "#c3e88d",
    darkCyan: "#89ddff",
    darkBlue: "#82aaff",
    darkPurple: "#c792ea",
    darkViolet: "#bb80b3",
    lightBg: "#fafafa",
    lightBgAlt: "#f5f5f5",
    lightBgPanel: "#e7e7e8",
    lightFg: "#263238",
    lightFgMuted: "#90a4ae",
    lightRed: "#e53935",
    lightPink: "#ec407a",
    lightOrange: "#f4511e",
    lightYellow: "#ffb300",
    lightGreen: "#91b859",
    lightCyan: "#39adb5",
    lightBlue: "#6182b8",
    lightPurple: "#7c4dff",
    lightViolet: "#945eb8"
  },
  theme: {
    primary: {
      dark: "darkBlue",
      light: "lightBlue"
    },
    secondary: {
      dark: "darkPurple",
      light: "lightPurple"
    },
    accent: {
      dark: "darkCyan",
      light: "lightCyan"
    },
    error: {
      dark: "darkRed",
      light: "lightRed"
    },
    warning: {
      dark: "darkYellow",
      light: "lightYellow"
    },
    success: {
      dark: "darkGreen",
      light: "lightGreen"
    },
    info: {
      dark: "darkOrange",
      light: "lightOrange"
    },
    text: {
      dark: "darkFg",
      light: "lightFg"
    },
    textMuted: {
      dark: "darkFgMuted",
      light: "lightFgMuted"
    },
    background: {
      dark: "darkBg",
      light: "lightBg"
    },
    backgroundPanel: {
      dark: "darkBgAlt",
      light: "lightBgAlt"
    },
    backgroundElement: {
      dark: "darkBgPanel",
      light: "lightBgPanel"
    },
    border: {
      dark: "#37474f",
      light: "#e0e0e0"
    },
    borderActive: {
      dark: "darkBlue",
      light: "lightBlue"
    },
    borderSubtle: {
      dark: "#1e272c",
      light: "#eeeeee"
    },
    diffAdded: {
      dark: "darkGreen",
      light: "lightGreen"
    },
    diffRemoved: {
      dark: "darkRed",
      light: "lightRed"
    },
    diffContext: {
      dark: "darkFgMuted",
      light: "lightFgMuted"
    },
    diffHunkHeader: {
      dark: "darkCyan",
      light: "lightCyan"
    },
    diffHighlightAdded: {
      dark: "darkGreen",
      light: "lightGreen"
    },
    diffHighlightRemoved: {
      dark: "darkRed",
      light: "lightRed"
    },
    diffAddedBg: {
      dark: "#2e3c2b",
      light: "#e8f5e9"
    },
    diffRemovedBg: {
      dark: "#3c2b2b",
      light: "#ffebee"
    },
    diffContextBg: {
      dark: "darkBgAlt",
      light: "lightBgAlt"
    },
    diffLineNumber: {
      dark: "#9aa2a6",
      light: "#6a6e70"
    },
    diffAddedLineNumberBg: {
      dark: "#2e3c2b",
      light: "#e8f5e9"
    },
    diffRemovedLineNumberBg: {
      dark: "#3c2b2b",
      light: "#ffebee"
    },
    markdownText: {
      dark: "darkFg",
      light: "lightFg"
    },
    markdownHeading: {
      dark: "darkBlue",
      light: "lightBlue"
    },
    markdownLink: {
      dark: "darkCyan",
      light: "lightCyan"
    },
    markdownLinkText: {
      dark: "darkPurple",
      light: "lightPurple"
    },
    markdownCode: {
      dark: "darkGreen",
      light: "lightGreen"
    },
    markdownBlockQuote: {
      dark: "darkFgMuted",
      light: "lightFgMuted"
    },
    markdownEmph: {
      dark: "darkYellow",
      light: "lightYellow"
    },
    markdownStrong: {
      dark: "darkOrange",
      light: "lightOrange"
    },
    markdownHorizontalRule: {
      dark: "#37474f",
      light: "#e0e0e0"
    },
    markdownListItem: {
      dark: "darkBlue",
      light: "lightBlue"
    },
    markdownListEnumeration: {
      dark: "darkCyan",
      light: "lightCyan"
    },
    markdownImage: {
      dark: "darkCyan",
      light: "lightCyan"
    },
    markdownImageText: {
      dark: "darkPurple",
      light: "lightPurple"
    },
    markdownCodeBlock: {
      dark: "darkFg",
      light: "lightFg"
    },
    syntaxComment: {
      dark: "darkFgMuted",
      light: "lightFgMuted"
    },
    syntaxKeyword: {
      dark: "darkPurple",
      light: "lightPurple"
    },
    syntaxFunction: {
      dark: "darkBlue",
      light: "lightBlue"
    },
    syntaxVariable: {
      dark: "darkFg",
      light: "lightFg"
    },
    syntaxString: {
      dark: "darkGreen",
      light: "lightGreen"
    },
    syntaxNumber: {
      dark: "darkOrange",
      light: "lightOrange"
    },
    syntaxType: {
      dark: "darkYellow",
      light: "lightYellow"
    },
    syntaxOperator: {
      dark: "darkCyan",
      light: "lightCyan"
    },
    syntaxPunctuation: {
      dark: "darkFg",
      light: "lightFg"
    }
  }
};
// ../tui-base/src/theme/assets/matrix.json
var matrix_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    matrixInk0: "#0a0e0a",
    matrixInk1: "#0e130d",
    matrixInk2: "#141c12",
    matrixInk3: "#1e2a1b",
    rainGreen: "#2eff6a",
    rainGreenDim: "#1cc24b",
    rainGreenHi: "#62ff94",
    rainCyan: "#00efff",
    rainTeal: "#24f6d9",
    rainPurple: "#c770ff",
    rainOrange: "#ffa83d",
    alertRed: "#ff4b4b",
    alertYellow: "#e6ff57",
    alertBlue: "#30b3ff",
    rainGray: "#8ca391",
    lightBg: "#eef3ea",
    lightPaper: "#e4ebe1",
    lightInk1: "#dae1d7",
    lightText: "#203022",
    lightGray: "#748476"
  },
  theme: {
    primary: { dark: "rainGreen", light: "rainGreenDim" },
    secondary: { dark: "rainCyan", light: "rainTeal" },
    accent: { dark: "rainPurple", light: "rainPurple" },
    error: { dark: "alertRed", light: "alertRed" },
    warning: { dark: "alertYellow", light: "alertYellow" },
    success: { dark: "rainGreenHi", light: "rainGreenDim" },
    info: { dark: "alertBlue", light: "alertBlue" },
    text: { dark: "rainGreenHi", light: "lightText" },
    textMuted: { dark: "rainGray", light: "lightGray" },
    background: { dark: "matrixInk0", light: "lightBg" },
    backgroundPanel: { dark: "matrixInk1", light: "lightPaper" },
    backgroundElement: { dark: "matrixInk2", light: "lightInk1" },
    border: { dark: "matrixInk3", light: "lightGray" },
    borderActive: { dark: "rainGreen", light: "rainGreenDim" },
    borderSubtle: { dark: "matrixInk2", light: "lightInk1" },
    diffAdded: { dark: "rainGreenDim", light: "rainGreenDim" },
    diffRemoved: { dark: "alertRed", light: "alertRed" },
    diffContext: { dark: "rainGray", light: "lightGray" },
    diffHunkHeader: { dark: "alertBlue", light: "alertBlue" },
    diffHighlightAdded: { dark: "#77ffaf", light: "#5dac7e" },
    diffHighlightRemoved: { dark: "#ff7171", light: "#d53a3a" },
    diffAddedBg: { dark: "#132616", light: "#e0efde" },
    diffRemovedBg: { dark: "#261212", light: "#f9e5e5" },
    diffContextBg: { dark: "matrixInk1", light: "lightPaper" },
    diffLineNumber: { dark: "textMuted", light: "#556156" },
    diffAddedLineNumberBg: { dark: "#0f1b11", light: "#d6e7d2" },
    diffRemovedLineNumberBg: { dark: "#1b1414", light: "#f2d2d2" },
    markdownText: { dark: "rainGreenHi", light: "lightText" },
    markdownHeading: { dark: "rainCyan", light: "rainTeal" },
    markdownLink: { dark: "alertBlue", light: "alertBlue" },
    markdownLinkText: { dark: "rainTeal", light: "rainTeal" },
    markdownCode: { dark: "rainGreenDim", light: "rainGreenDim" },
    markdownBlockQuote: { dark: "rainGray", light: "lightGray" },
    markdownEmph: { dark: "rainOrange", light: "rainOrange" },
    markdownStrong: { dark: "alertYellow", light: "alertYellow" },
    markdownHorizontalRule: { dark: "rainGray", light: "lightGray" },
    markdownListItem: { dark: "alertBlue", light: "alertBlue" },
    markdownListEnumeration: { dark: "rainTeal", light: "rainTeal" },
    markdownImage: { dark: "alertBlue", light: "alertBlue" },
    markdownImageText: { dark: "rainTeal", light: "rainTeal" },
    markdownCodeBlock: { dark: "rainGreenHi", light: "lightText" },
    syntaxComment: { dark: "rainGray", light: "lightGray" },
    syntaxKeyword: { dark: "rainPurple", light: "rainPurple" },
    syntaxFunction: { dark: "alertBlue", light: "alertBlue" },
    syntaxVariable: { dark: "rainGreenHi", light: "lightText" },
    syntaxString: { dark: "rainGreenDim", light: "rainGreenDim" },
    syntaxNumber: { dark: "rainOrange", light: "rainOrange" },
    syntaxType: { dark: "alertYellow", light: "alertYellow" },
    syntaxOperator: { dark: "rainTeal", light: "rainTeal" },
    syntaxPunctuation: { dark: "rainGreenHi", light: "lightText" }
  }
};
// ../tui-base/src/theme/assets/mercury.json
var mercury_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    "purple-800": "#3442a6",
    "purple-700": "#465bd1",
    "purple-600": "#5266eb",
    "purple-400": "#8da4f5",
    "purple-300": "#a7b6f8",
    "red-700": "#b0175f",
    "red-600": "#d03275",
    "red-400": "#fc92b4",
    "green-700": "#036e43",
    "green-600": "#188554",
    "green-400": "#77c599",
    "orange-700": "#a44200",
    "orange-600": "#c45000",
    "orange-400": "#fc9b6f",
    "blue-600": "#007f95",
    "blue-400": "#77becf",
    "neutral-1000": "#10101a",
    "neutral-950": "#171721",
    "neutral-900": "#1e1e2a",
    "neutral-800": "#272735",
    "neutral-700": "#363644",
    "neutral-600": "#535461",
    "neutral-500": "#70707d",
    "neutral-400": "#9d9da8",
    "neutral-300": "#c3c3cc",
    "neutral-200": "#dddde5",
    "neutral-100": "#f4f5f9",
    "neutral-050": "#fbfcfd",
    "neutral-000": "#ffffff",
    "neutral-150": "#ededf3",
    "border-light": "#7073931a",
    "border-light-subtle": "#7073930f",
    "border-dark": "#b4b7c81f",
    "border-dark-subtle": "#b4b7c814",
    "diff-added-light": "#1885541a",
    "diff-removed-light": "#d032751a",
    "diff-added-dark": "#77c59933",
    "diff-removed-dark": "#fc92b433"
  },
  theme: {
    primary: {
      light: "purple-600",
      dark: "purple-400"
    },
    secondary: {
      light: "purple-700",
      dark: "purple-300"
    },
    accent: {
      light: "purple-400",
      dark: "purple-400"
    },
    error: {
      light: "red-700",
      dark: "red-400"
    },
    warning: {
      light: "orange-700",
      dark: "orange-400"
    },
    success: {
      light: "green-700",
      dark: "green-400"
    },
    info: {
      light: "blue-600",
      dark: "blue-400"
    },
    text: {
      light: "neutral-700",
      dark: "neutral-200"
    },
    textMuted: {
      light: "neutral-500",
      dark: "neutral-400"
    },
    background: {
      light: "neutral-000",
      dark: "neutral-950"
    },
    backgroundPanel: {
      light: "neutral-050",
      dark: "neutral-1000"
    },
    backgroundElement: {
      light: "neutral-100",
      dark: "neutral-800"
    },
    border: {
      light: "border-light",
      dark: "border-dark"
    },
    borderActive: {
      light: "purple-600",
      dark: "purple-400"
    },
    borderSubtle: {
      light: "border-light-subtle",
      dark: "border-dark-subtle"
    },
    diffAdded: {
      light: "green-700",
      dark: "green-400"
    },
    diffRemoved: {
      light: "red-700",
      dark: "red-400"
    },
    diffContext: {
      light: "neutral-500",
      dark: "neutral-400"
    },
    diffHunkHeader: {
      light: "neutral-500",
      dark: "neutral-400"
    },
    diffHighlightAdded: {
      light: "green-700",
      dark: "green-400"
    },
    diffHighlightRemoved: {
      light: "red-700",
      dark: "red-400"
    },
    diffAddedBg: {
      light: "diff-added-light",
      dark: "diff-added-dark"
    },
    diffRemovedBg: {
      light: "diff-removed-light",
      dark: "diff-removed-dark"
    },
    diffContextBg: {
      light: "neutral-050",
      dark: "neutral-900"
    },
    diffLineNumber: {
      light: "neutral-600",
      dark: "neutral-300"
    },
    diffAddedLineNumberBg: {
      light: "diff-added-light",
      dark: "diff-added-dark"
    },
    diffRemovedLineNumberBg: {
      light: "diff-removed-light",
      dark: "diff-removed-dark"
    },
    markdownText: {
      light: "neutral-700",
      dark: "neutral-200"
    },
    markdownHeading: {
      light: "neutral-900",
      dark: "neutral-000"
    },
    markdownLink: {
      light: "purple-700",
      dark: "purple-400"
    },
    markdownLinkText: {
      light: "purple-600",
      dark: "purple-300"
    },
    markdownCode: {
      light: "green-700",
      dark: "green-400"
    },
    markdownBlockQuote: {
      light: "neutral-500",
      dark: "neutral-400"
    },
    markdownEmph: {
      light: "orange-700",
      dark: "orange-400"
    },
    markdownStrong: {
      light: "neutral-900",
      dark: "neutral-100"
    },
    markdownHorizontalRule: {
      light: "border-light",
      dark: "border-dark"
    },
    markdownListItem: {
      light: "neutral-900",
      dark: "neutral-000"
    },
    markdownListEnumeration: {
      light: "purple-600",
      dark: "purple-400"
    },
    markdownImage: {
      light: "purple-700",
      dark: "purple-400"
    },
    markdownImageText: {
      light: "purple-600",
      dark: "purple-300"
    },
    markdownCodeBlock: {
      light: "neutral-700",
      dark: "neutral-200"
    },
    syntaxComment: {
      light: "neutral-500",
      dark: "neutral-400"
    },
    syntaxKeyword: {
      light: "purple-700",
      dark: "purple-400"
    },
    syntaxFunction: {
      light: "purple-600",
      dark: "purple-400"
    },
    syntaxVariable: {
      light: "blue-600",
      dark: "blue-400"
    },
    syntaxString: {
      light: "green-700",
      dark: "green-400"
    },
    syntaxNumber: {
      light: "orange-700",
      dark: "orange-400"
    },
    syntaxType: {
      light: "blue-600",
      dark: "blue-400"
    },
    syntaxOperator: {
      light: "purple-700",
      dark: "purple-400"
    },
    syntaxPunctuation: {
      light: "neutral-700",
      dark: "neutral-200"
    }
  }
};
// ../tui-base/src/theme/assets/monokai.json
var monokai_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    background: "#272822",
    backgroundAlt: "#1e1f1c",
    backgroundPanel: "#3e3d32",
    foreground: "#f8f8f2",
    comment: "#75715e",
    red: "#f92672",
    orange: "#fd971f",
    lightOrange: "#e69f66",
    yellow: "#e6db74",
    green: "#a6e22e",
    cyan: "#66d9ef",
    blue: "#66d9ef",
    purple: "#ae81ff",
    pink: "#f92672"
  },
  theme: {
    primary: {
      dark: "cyan",
      light: "blue"
    },
    secondary: {
      dark: "purple",
      light: "purple"
    },
    accent: {
      dark: "green",
      light: "green"
    },
    error: {
      dark: "red",
      light: "red"
    },
    warning: {
      dark: "yellow",
      light: "orange"
    },
    success: {
      dark: "green",
      light: "green"
    },
    info: {
      dark: "orange",
      light: "orange"
    },
    text: {
      dark: "foreground",
      light: "#272822"
    },
    textMuted: {
      dark: "comment",
      light: "#75715e"
    },
    background: {
      dark: "#272822",
      light: "#fafafa"
    },
    backgroundPanel: {
      dark: "#1e1f1c",
      light: "#f0f0f0"
    },
    backgroundElement: {
      dark: "#3e3d32",
      light: "#e0e0e0"
    },
    border: {
      dark: "#3e3d32",
      light: "#d0d0d0"
    },
    borderActive: {
      dark: "cyan",
      light: "blue"
    },
    borderSubtle: {
      dark: "#1e1f1c",
      light: "#e8e8e8"
    },
    diffAdded: {
      dark: "green",
      light: "green"
    },
    diffRemoved: {
      dark: "red",
      light: "red"
    },
    diffContext: {
      dark: "comment",
      light: "#75715e"
    },
    diffHunkHeader: {
      dark: "comment",
      light: "#75715e"
    },
    diffHighlightAdded: {
      dark: "green",
      light: "green"
    },
    diffHighlightRemoved: {
      dark: "red",
      light: "red"
    },
    diffAddedBg: {
      dark: "#1a3a1a",
      light: "#e0ffe0"
    },
    diffRemovedBg: {
      dark: "#3a1a1a",
      light: "#ffe0e0"
    },
    diffContextBg: {
      dark: "#1e1f1c",
      light: "#f0f0f0"
    },
    diffLineNumber: {
      dark: "#9b9b95",
      light: "#686868"
    },
    diffAddedLineNumberBg: {
      dark: "#1a3a1a",
      light: "#e0ffe0"
    },
    diffRemovedLineNumberBg: {
      dark: "#3a1a1a",
      light: "#ffe0e0"
    },
    markdownText: {
      dark: "foreground",
      light: "#272822"
    },
    markdownHeading: {
      dark: "pink",
      light: "pink"
    },
    markdownLink: {
      dark: "cyan",
      light: "blue"
    },
    markdownLinkText: {
      dark: "purple",
      light: "purple"
    },
    markdownCode: {
      dark: "green",
      light: "green"
    },
    markdownBlockQuote: {
      dark: "comment",
      light: "#75715e"
    },
    markdownEmph: {
      dark: "yellow",
      light: "orange"
    },
    markdownStrong: {
      dark: "orange",
      light: "orange"
    },
    markdownHorizontalRule: {
      dark: "comment",
      light: "#75715e"
    },
    markdownListItem: {
      dark: "cyan",
      light: "blue"
    },
    markdownListEnumeration: {
      dark: "purple",
      light: "purple"
    },
    markdownImage: {
      dark: "cyan",
      light: "blue"
    },
    markdownImageText: {
      dark: "purple",
      light: "purple"
    },
    markdownCodeBlock: {
      dark: "foreground",
      light: "#272822"
    },
    syntaxComment: {
      dark: "comment",
      light: "#75715e"
    },
    syntaxKeyword: {
      dark: "pink",
      light: "pink"
    },
    syntaxFunction: {
      dark: "green",
      light: "green"
    },
    syntaxVariable: {
      dark: "foreground",
      light: "#272822"
    },
    syntaxString: {
      dark: "yellow",
      light: "orange"
    },
    syntaxNumber: {
      dark: "purple",
      light: "purple"
    },
    syntaxType: {
      dark: "cyan",
      light: "blue"
    },
    syntaxOperator: {
      dark: "pink",
      light: "pink"
    },
    syntaxPunctuation: {
      dark: "foreground",
      light: "#272822"
    }
  }
};
// ../tui-base/src/theme/assets/nightowl.json
var nightowl_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    nightOwlBg: "#011627",
    nightOwlFg: "#d6deeb",
    nightOwlBlue: "#82AAFF",
    nightOwlCyan: "#7fdbca",
    nightOwlGreen: "#c5e478",
    nightOwlYellow: "#ecc48d",
    nightOwlOrange: "#F78C6C",
    nightOwlRed: "#EF5350",
    nightOwlPink: "#ff5874",
    nightOwlPurple: "#c792ea",
    nightOwlMuted: "#5f7e97",
    nightOwlGray: "#637777",
    nightOwlLightGray: "#89a4bb",
    nightOwlPanel: "#0b253a"
  },
  theme: {
    primary: {
      dark: "nightOwlBlue",
      light: "nightOwlBlue"
    },
    secondary: {
      dark: "nightOwlCyan",
      light: "nightOwlCyan"
    },
    accent: {
      dark: "nightOwlPurple",
      light: "nightOwlPurple"
    },
    error: {
      dark: "nightOwlRed",
      light: "nightOwlRed"
    },
    warning: {
      dark: "nightOwlYellow",
      light: "nightOwlYellow"
    },
    success: {
      dark: "nightOwlGreen",
      light: "nightOwlGreen"
    },
    info: {
      dark: "nightOwlBlue",
      light: "nightOwlBlue"
    },
    text: {
      dark: "nightOwlFg",
      light: "nightOwlFg"
    },
    textMuted: {
      dark: "nightOwlMuted",
      light: "nightOwlMuted"
    },
    background: {
      dark: "nightOwlBg",
      light: "nightOwlBg"
    },
    backgroundPanel: {
      dark: "nightOwlPanel",
      light: "nightOwlPanel"
    },
    backgroundElement: {
      dark: "nightOwlPanel",
      light: "nightOwlPanel"
    },
    border: {
      dark: "nightOwlMuted",
      light: "nightOwlMuted"
    },
    borderActive: {
      dark: "nightOwlBlue",
      light: "nightOwlBlue"
    },
    borderSubtle: {
      dark: "nightOwlMuted",
      light: "nightOwlMuted"
    },
    diffAdded: {
      dark: "nightOwlGreen",
      light: "nightOwlGreen"
    },
    diffRemoved: {
      dark: "nightOwlRed",
      light: "nightOwlRed"
    },
    diffContext: {
      dark: "nightOwlMuted",
      light: "nightOwlMuted"
    },
    diffHunkHeader: {
      dark: "nightOwlMuted",
      light: "nightOwlMuted"
    },
    diffHighlightAdded: {
      dark: "nightOwlGreen",
      light: "nightOwlGreen"
    },
    diffHighlightRemoved: {
      dark: "nightOwlRed",
      light: "nightOwlRed"
    },
    diffAddedBg: {
      dark: "#0a2e1a",
      light: "#0a2e1a"
    },
    diffRemovedBg: {
      dark: "#2d1b1b",
      light: "#2d1b1b"
    },
    diffContextBg: {
      dark: "nightOwlPanel",
      light: "nightOwlPanel"
    },
    diffLineNumber: {
      dark: "#7791a6",
      light: "#7791a6"
    },
    diffAddedLineNumberBg: {
      dark: "#0a2e1a",
      light: "#0a2e1a"
    },
    diffRemovedLineNumberBg: {
      dark: "#2d1b1b",
      light: "#2d1b1b"
    },
    markdownText: {
      dark: "nightOwlFg",
      light: "nightOwlFg"
    },
    markdownHeading: {
      dark: "nightOwlBlue",
      light: "nightOwlBlue"
    },
    markdownLink: {
      dark: "nightOwlCyan",
      light: "nightOwlCyan"
    },
    markdownLinkText: {
      dark: "nightOwlBlue",
      light: "nightOwlBlue"
    },
    markdownCode: {
      dark: "nightOwlGreen",
      light: "nightOwlGreen"
    },
    markdownBlockQuote: {
      dark: "nightOwlMuted",
      light: "nightOwlMuted"
    },
    markdownEmph: {
      dark: "nightOwlPurple",
      light: "nightOwlPurple"
    },
    markdownStrong: {
      dark: "nightOwlYellow",
      light: "nightOwlYellow"
    },
    markdownHorizontalRule: {
      dark: "nightOwlMuted",
      light: "nightOwlMuted"
    },
    markdownListItem: {
      dark: "nightOwlBlue",
      light: "nightOwlBlue"
    },
    markdownListEnumeration: {
      dark: "nightOwlCyan",
      light: "nightOwlCyan"
    },
    markdownImage: {
      dark: "nightOwlCyan",
      light: "nightOwlCyan"
    },
    markdownImageText: {
      dark: "nightOwlBlue",
      light: "nightOwlBlue"
    },
    markdownCodeBlock: {
      dark: "nightOwlFg",
      light: "nightOwlFg"
    },
    syntaxComment: {
      dark: "nightOwlGray",
      light: "nightOwlGray"
    },
    syntaxKeyword: {
      dark: "nightOwlPurple",
      light: "nightOwlPurple"
    },
    syntaxFunction: {
      dark: "nightOwlBlue",
      light: "nightOwlBlue"
    },
    syntaxVariable: {
      dark: "nightOwlFg",
      light: "nightOwlFg"
    },
    syntaxString: {
      dark: "nightOwlYellow",
      light: "nightOwlYellow"
    },
    syntaxNumber: {
      dark: "nightOwlOrange",
      light: "nightOwlOrange"
    },
    syntaxType: {
      dark: "nightOwlGreen",
      light: "nightOwlGreen"
    },
    syntaxOperator: {
      dark: "nightOwlCyan",
      light: "nightOwlCyan"
    },
    syntaxPunctuation: {
      dark: "nightOwlFg",
      light: "nightOwlFg"
    }
  }
};
// ../tui-base/src/theme/assets/nord.json
var nord_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    nord0: "#2E3440",
    nord1: "#3B4252",
    nord2: "#434C5E",
    nord3: "#4C566A",
    nord4: "#D8DEE9",
    nord5: "#E5E9F0",
    nord6: "#ECEFF4",
    nord7: "#8FBCBB",
    nord8: "#88C0D0",
    nord9: "#81A1C1",
    nord10: "#5E81AC",
    nord11: "#BF616A",
    nord12: "#D08770",
    nord13: "#EBCB8B",
    nord14: "#A3BE8C",
    nord15: "#B48EAD"
  },
  theme: {
    primary: {
      dark: "nord8",
      light: "nord10"
    },
    secondary: {
      dark: "nord9",
      light: "nord9"
    },
    accent: {
      dark: "nord7",
      light: "nord7"
    },
    error: {
      dark: "nord11",
      light: "nord11"
    },
    warning: {
      dark: "nord12",
      light: "nord12"
    },
    success: {
      dark: "nord14",
      light: "nord14"
    },
    info: {
      dark: "nord8",
      light: "nord10"
    },
    text: {
      dark: "nord6",
      light: "nord0"
    },
    textMuted: {
      dark: "#8B95A7",
      light: "nord1"
    },
    background: {
      dark: "nord0",
      light: "nord6"
    },
    backgroundPanel: {
      dark: "nord1",
      light: "nord5"
    },
    backgroundElement: {
      dark: "nord2",
      light: "nord4"
    },
    border: {
      dark: "nord2",
      light: "nord3"
    },
    borderActive: {
      dark: "nord3",
      light: "nord2"
    },
    borderSubtle: {
      dark: "nord2",
      light: "nord3"
    },
    diffAdded: {
      dark: "nord14",
      light: "nord14"
    },
    diffRemoved: {
      dark: "nord11",
      light: "nord11"
    },
    diffContext: {
      dark: "#8B95A7",
      light: "nord3"
    },
    diffHunkHeader: {
      dark: "#8B95A7",
      light: "nord3"
    },
    diffHighlightAdded: {
      dark: "nord14",
      light: "nord14"
    },
    diffHighlightRemoved: {
      dark: "nord11",
      light: "nord11"
    },
    diffAddedBg: {
      dark: "#3B4252",
      light: "#E5E9F0"
    },
    diffRemovedBg: {
      dark: "#3B4252",
      light: "#E5E9F0"
    },
    diffContextBg: {
      dark: "nord1",
      light: "nord5"
    },
    diffLineNumber: {
      dark: "#a9aeb6",
      light: "textMuted"
    },
    diffAddedLineNumberBg: {
      dark: "#3B4252",
      light: "#E5E9F0"
    },
    diffRemovedLineNumberBg: {
      dark: "#3B4252",
      light: "#E5E9F0"
    },
    markdownText: {
      dark: "nord4",
      light: "nord0"
    },
    markdownHeading: {
      dark: "nord8",
      light: "nord10"
    },
    markdownLink: {
      dark: "nord9",
      light: "nord9"
    },
    markdownLinkText: {
      dark: "nord7",
      light: "nord7"
    },
    markdownCode: {
      dark: "nord14",
      light: "nord14"
    },
    markdownBlockQuote: {
      dark: "#8B95A7",
      light: "nord3"
    },
    markdownEmph: {
      dark: "nord12",
      light: "nord12"
    },
    markdownStrong: {
      dark: "nord13",
      light: "nord13"
    },
    markdownHorizontalRule: {
      dark: "#8B95A7",
      light: "nord3"
    },
    markdownListItem: {
      dark: "nord8",
      light: "nord10"
    },
    markdownListEnumeration: {
      dark: "nord7",
      light: "nord7"
    },
    markdownImage: {
      dark: "nord9",
      light: "nord9"
    },
    markdownImageText: {
      dark: "nord7",
      light: "nord7"
    },
    markdownCodeBlock: {
      dark: "nord4",
      light: "nord0"
    },
    syntaxComment: {
      dark: "#8B95A7",
      light: "nord3"
    },
    syntaxKeyword: {
      dark: "nord9",
      light: "nord9"
    },
    syntaxFunction: {
      dark: "nord8",
      light: "nord8"
    },
    syntaxVariable: {
      dark: "nord7",
      light: "nord7"
    },
    syntaxString: {
      dark: "nord14",
      light: "nord14"
    },
    syntaxNumber: {
      dark: "nord15",
      light: "nord15"
    },
    syntaxType: {
      dark: "nord7",
      light: "nord7"
    },
    syntaxOperator: {
      dark: "nord9",
      light: "nord9"
    },
    syntaxPunctuation: {
      dark: "nord4",
      light: "nord0"
    }
  }
};
// ../tui-base/src/theme/assets/one-dark.json
var one_dark_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    darkBg: "#282c34",
    darkBgAlt: "#21252b",
    darkBgPanel: "#353b45",
    darkFg: "#abb2bf",
    darkFgMuted: "#5c6370",
    darkPurple: "#c678dd",
    darkBlue: "#61afef",
    darkRed: "#e06c75",
    darkGreen: "#98c379",
    darkYellow: "#e5c07b",
    darkOrange: "#d19a66",
    darkCyan: "#56b6c2",
    lightBg: "#fafafa",
    lightBgAlt: "#f0f0f1",
    lightBgPanel: "#eaeaeb",
    lightFg: "#383a42",
    lightFgMuted: "#a0a1a7",
    lightPurple: "#a626a4",
    lightBlue: "#4078f2",
    lightRed: "#e45649",
    lightGreen: "#50a14f",
    lightYellow: "#c18401",
    lightOrange: "#986801",
    lightCyan: "#0184bc"
  },
  theme: {
    primary: { dark: "darkBlue", light: "lightBlue" },
    secondary: { dark: "darkPurple", light: "lightPurple" },
    accent: { dark: "darkCyan", light: "lightCyan" },
    error: { dark: "darkRed", light: "lightRed" },
    warning: { dark: "darkYellow", light: "lightYellow" },
    success: { dark: "darkGreen", light: "lightGreen" },
    info: { dark: "darkOrange", light: "lightOrange" },
    text: { dark: "darkFg", light: "lightFg" },
    textMuted: { dark: "darkFgMuted", light: "lightFgMuted" },
    background: { dark: "darkBg", light: "lightBg" },
    backgroundPanel: { dark: "darkBgAlt", light: "lightBgAlt" },
    backgroundElement: { dark: "darkBgPanel", light: "lightBgPanel" },
    border: { dark: "#393f4a", light: "#d1d1d2" },
    borderActive: { dark: "darkBlue", light: "lightBlue" },
    borderSubtle: { dark: "#2c313a", light: "#e0e0e1" },
    diffAdded: { dark: "darkGreen", light: "lightGreen" },
    diffRemoved: { dark: "darkRed", light: "lightRed" },
    diffContext: { dark: "darkFgMuted", light: "lightFgMuted" },
    diffHunkHeader: { dark: "darkCyan", light: "lightCyan" },
    diffHighlightAdded: { dark: "#aad482", light: "#489447" },
    diffHighlightRemoved: { dark: "#e8828b", light: "#d65145" },
    diffAddedBg: { dark: "#2c382b", light: "#eafbe9" },
    diffRemovedBg: { dark: "#3a2d2f", light: "#fce9e8" },
    diffContextBg: { dark: "darkBgAlt", light: "lightBgAlt" },
    diffLineNumber: { dark: "#9398a2", light: "#666666" },
    diffAddedLineNumberBg: { dark: "#283427", light: "#e1f3df" },
    diffRemovedLineNumberBg: { dark: "#36292b", light: "#f5e2e1" },
    markdownText: { dark: "darkFg", light: "lightFg" },
    markdownHeading: { dark: "darkPurple", light: "lightPurple" },
    markdownLink: { dark: "darkBlue", light: "lightBlue" },
    markdownLinkText: { dark: "darkCyan", light: "lightCyan" },
    markdownCode: { dark: "darkGreen", light: "lightGreen" },
    markdownBlockQuote: { dark: "darkFgMuted", light: "lightFgMuted" },
    markdownEmph: { dark: "darkYellow", light: "lightYellow" },
    markdownStrong: { dark: "darkOrange", light: "lightOrange" },
    markdownHorizontalRule: {
      dark: "darkFgMuted",
      light: "lightFgMuted"
    },
    markdownListItem: { dark: "darkBlue", light: "lightBlue" },
    markdownListEnumeration: { dark: "darkCyan", light: "lightCyan" },
    markdownImage: { dark: "darkBlue", light: "lightBlue" },
    markdownImageText: { dark: "darkCyan", light: "lightCyan" },
    markdownCodeBlock: { dark: "darkFg", light: "lightFg" },
    syntaxComment: { dark: "darkFgMuted", light: "lightFgMuted" },
    syntaxKeyword: { dark: "darkPurple", light: "lightPurple" },
    syntaxFunction: { dark: "darkBlue", light: "lightBlue" },
    syntaxVariable: { dark: "darkRed", light: "lightRed" },
    syntaxString: { dark: "darkGreen", light: "lightGreen" },
    syntaxNumber: { dark: "darkOrange", light: "lightOrange" },
    syntaxType: { dark: "darkYellow", light: "lightYellow" },
    syntaxOperator: { dark: "darkCyan", light: "lightCyan" },
    syntaxPunctuation: { dark: "darkFg", light: "lightFg" }
  }
};
// ../tui-base/src/theme/assets/orng.json
var orng_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    darkStep1: "#0a0a0a",
    darkStep2: "#141414",
    darkStep3: "#1e1e1e",
    darkStep4: "#282828",
    darkStep5: "#323232",
    darkStep6: "#3c3c3c",
    darkStep7: "#484848",
    darkStep8: "#606060",
    darkStep9: "#EC5B2B",
    darkStep10: "#EE7948",
    darkStep11: "#808080",
    darkStep12: "#eeeeee",
    darkSecondary: "#EE7948",
    darkAccent: "#FFF7F1",
    darkRed: "#e06c75",
    darkOrange: "#EC5B2B",
    darkBlue: "#6ba1e6",
    darkCyan: "#56b6c2",
    darkYellow: "#e5c07b",
    lightStep1: "#ffffff",
    lightStep2: "#FFF7F1",
    lightStep3: "#f5f0eb",
    lightStep4: "#ebebeb",
    lightStep5: "#e1e1e1",
    lightStep6: "#d4d4d4",
    lightStep7: "#b8b8b8",
    lightStep8: "#a0a0a0",
    lightStep9: "#EC5B2B",
    lightStep10: "#c94d24",
    lightStep11: "#8a8a8a",
    lightStep12: "#1a1a1a",
    lightSecondary: "#EE7948",
    lightAccent: "#c94d24",
    lightRed: "#d1383d",
    lightOrange: "#EC5B2B",
    lightBlue: "#0062d1",
    lightCyan: "#318795",
    lightYellow: "#b0851f"
  },
  theme: {
    primary: {
      dark: "darkStep9",
      light: "lightStep9"
    },
    secondary: {
      dark: "darkSecondary",
      light: "lightSecondary"
    },
    accent: {
      dark: "darkAccent",
      light: "lightAccent"
    },
    error: {
      dark: "darkRed",
      light: "lightRed"
    },
    warning: {
      dark: "darkOrange",
      light: "lightOrange"
    },
    success: {
      dark: "darkBlue",
      light: "lightBlue"
    },
    info: {
      dark: "darkCyan",
      light: "lightCyan"
    },
    text: {
      dark: "darkStep12",
      light: "lightStep12"
    },
    textMuted: {
      dark: "darkStep11",
      light: "lightStep11"
    },
    selectedListItemText: {
      dark: "#0a0a0a",
      light: "#ffffff"
    },
    background: {
      dark: "darkStep1",
      light: "lightStep1"
    },
    backgroundPanel: {
      dark: "darkStep2",
      light: "lightStep2"
    },
    backgroundElement: {
      dark: "darkStep3",
      light: "lightStep3"
    },
    border: {
      dark: "#EC5B2B",
      light: "#EC5B2B"
    },
    borderActive: {
      dark: "#EE7948",
      light: "#c94d24"
    },
    borderSubtle: {
      dark: "darkStep6",
      light: "lightStep6"
    },
    diffAdded: {
      dark: "#6ba1e6",
      light: "#0062d1"
    },
    diffRemoved: {
      dark: "#c53b53",
      light: "#c53b53"
    },
    diffContext: {
      dark: "#828bb8",
      light: "#7086b5"
    },
    diffHunkHeader: {
      dark: "#828bb8",
      light: "#7086b5"
    },
    diffHighlightAdded: {
      dark: "#6ba1e6",
      light: "#0062d1"
    },
    diffHighlightRemoved: {
      dark: "#e26a75",
      light: "#f52a65"
    },
    diffAddedBg: {
      dark: "#1a2a3d",
      light: "#e0edfa"
    },
    diffRemovedBg: {
      dark: "#37222c",
      light: "#f7d8db"
    },
    diffContextBg: {
      dark: "darkStep2",
      light: "lightStep2"
    },
    diffLineNumber: {
      dark: "diffContext",
      light: "#595755"
    },
    diffAddedLineNumberBg: {
      dark: "#162535",
      light: "#d0e5f5"
    },
    diffRemovedLineNumberBg: {
      dark: "#2d1f26",
      light: "#e7c8cb"
    },
    markdownText: {
      dark: "darkStep12",
      light: "lightStep12"
    },
    markdownHeading: {
      dark: "#EC5B2B",
      light: "#EC5B2B"
    },
    markdownLink: {
      dark: "darkStep9",
      light: "lightStep9"
    },
    markdownLinkText: {
      dark: "darkCyan",
      light: "lightCyan"
    },
    markdownCode: {
      dark: "darkBlue",
      light: "lightBlue"
    },
    markdownBlockQuote: {
      dark: "#FFF7F1",
      light: "lightYellow"
    },
    markdownEmph: {
      dark: "darkYellow",
      light: "lightYellow"
    },
    markdownStrong: {
      dark: "#EE7948",
      light: "#EC5B2B"
    },
    markdownHorizontalRule: {
      dark: "darkStep11",
      light: "lightStep11"
    },
    markdownListItem: {
      dark: "darkStep9",
      light: "lightStep9"
    },
    markdownListEnumeration: {
      dark: "darkCyan",
      light: "lightCyan"
    },
    markdownImage: {
      dark: "darkStep9",
      light: "lightStep9"
    },
    markdownImageText: {
      dark: "darkCyan",
      light: "lightCyan"
    },
    markdownCodeBlock: {
      dark: "darkStep12",
      light: "lightStep12"
    },
    syntaxComment: {
      dark: "darkStep11",
      light: "lightStep11"
    },
    syntaxKeyword: {
      dark: "#EC5B2B",
      light: "#EC5B2B"
    },
    syntaxFunction: {
      dark: "#EE7948",
      light: "#c94d24"
    },
    syntaxVariable: {
      dark: "darkRed",
      light: "lightRed"
    },
    syntaxString: {
      dark: "darkBlue",
      light: "lightBlue"
    },
    syntaxNumber: {
      dark: "#FFF7F1",
      light: "#EC5B2B"
    },
    syntaxType: {
      dark: "darkYellow",
      light: "lightYellow"
    },
    syntaxOperator: {
      dark: "darkCyan",
      light: "lightCyan"
    },
    syntaxPunctuation: {
      dark: "darkStep12",
      light: "lightStep12"
    }
  }
};
// ../tui-base/src/theme/assets/osaka-jade.json
var osaka_jade_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    darkBg0: "#111c18",
    darkBg1: "#1a2520",
    darkBg2: "#23372B",
    darkBg3: "#3d4a44",
    darkFg0: "#C1C497",
    darkFg1: "#9aa88a",
    darkGray: "#53685B",
    darkRed: "#FF5345",
    darkGreen: "#549e6a",
    darkYellow: "#459451",
    darkBlue: "#509475",
    darkMagenta: "#D2689C",
    darkCyan: "#2DD5B7",
    darkWhite: "#F6F5DD",
    darkRedBright: "#db9f9c",
    darkGreenBright: "#63b07a",
    darkYellowBright: "#E5C736",
    darkBlueBright: "#ACD4CF",
    darkMagentaBright: "#75bbb3",
    darkCyanBright: "#8CD3CB",
    lightBg0: "#F6F5DD",
    lightBg1: "#E8E7CC",
    lightBg2: "#D5D4B8",
    lightBg3: "#A8A78C",
    lightFg0: "#111c18",
    lightFg1: "#1a2520",
    lightGray: "#53685B",
    lightRed: "#c7392d",
    lightGreen: "#3d7a52",
    lightYellow: "#b5a020",
    lightBlue: "#3d7560",
    lightMagenta: "#a8527a",
    lightCyan: "#1faa90"
  },
  theme: {
    primary: { dark: "darkCyan", light: "lightCyan" },
    secondary: { dark: "darkMagenta", light: "lightMagenta" },
    accent: { dark: "darkGreen", light: "lightGreen" },
    error: { dark: "darkRed", light: "lightRed" },
    warning: { dark: "darkYellowBright", light: "lightYellow" },
    success: { dark: "darkGreen", light: "lightGreen" },
    info: { dark: "darkCyan", light: "lightCyan" },
    text: { dark: "darkFg0", light: "lightFg0" },
    textMuted: { dark: "darkGray", light: "lightGray" },
    background: { dark: "darkBg0", light: "lightBg0" },
    backgroundPanel: { dark: "darkBg1", light: "lightBg1" },
    backgroundElement: { dark: "darkBg2", light: "lightBg2" },
    border: { dark: "darkBg3", light: "lightBg3" },
    borderActive: { dark: "darkCyan", light: "lightCyan" },
    borderSubtle: { dark: "darkBg2", light: "lightBg2" },
    diffAdded: { dark: "darkGreen", light: "lightGreen" },
    diffRemoved: { dark: "darkRed", light: "lightRed" },
    diffContext: { dark: "darkGray", light: "lightGray" },
    diffHunkHeader: { dark: "darkCyan", light: "lightCyan" },
    diffHighlightAdded: { dark: "darkGreenBright", light: "lightGreen" },
    diffHighlightRemoved: { dark: "darkRedBright", light: "lightRed" },
    diffAddedBg: { dark: "#15241c", light: "#e0eee5" },
    diffRemovedBg: { dark: "#241515", light: "#eee0e0" },
    diffContextBg: { dark: "darkBg1", light: "lightBg1" },
    diffLineNumber: { dark: "#828b87", light: "#5f5e4f" },
    diffAddedLineNumberBg: { dark: "#121f18", light: "#d5e5da" },
    diffRemovedLineNumberBg: { dark: "#1f1212", light: "#e5d5d5" },
    markdownText: { dark: "darkFg0", light: "lightFg0" },
    markdownHeading: { dark: "darkCyan", light: "lightCyan" },
    markdownLink: { dark: "darkCyanBright", light: "lightCyan" },
    markdownLinkText: { dark: "darkGreen", light: "lightGreen" },
    markdownCode: { dark: "darkGreenBright", light: "lightGreen" },
    markdownBlockQuote: { dark: "darkGray", light: "lightGray" },
    markdownEmph: { dark: "darkMagenta", light: "lightMagenta" },
    markdownStrong: { dark: "darkFg0", light: "lightFg0" },
    markdownHorizontalRule: { dark: "darkGray", light: "lightGray" },
    markdownListItem: { dark: "darkCyan", light: "lightCyan" },
    markdownListEnumeration: {
      dark: "darkCyanBright",
      light: "lightCyan"
    },
    markdownImage: { dark: "darkCyanBright", light: "lightCyan" },
    markdownImageText: { dark: "darkGreen", light: "lightGreen" },
    markdownCodeBlock: { dark: "darkFg0", light: "lightFg0" },
    syntaxComment: { dark: "darkGray", light: "lightGray" },
    syntaxKeyword: { dark: "darkCyan", light: "lightCyan" },
    syntaxFunction: { dark: "darkBlue", light: "lightBlue" },
    syntaxVariable: { dark: "darkFg0", light: "lightFg0" },
    syntaxString: { dark: "darkGreenBright", light: "lightGreen" },
    syntaxNumber: { dark: "darkMagenta", light: "lightMagenta" },
    syntaxType: { dark: "darkGreen", light: "lightGreen" },
    syntaxOperator: { dark: "darkYellow", light: "lightYellow" },
    syntaxPunctuation: { dark: "darkFg0", light: "lightFg0" }
  }
};
// ../tui-base/src/theme/assets/palenight.json
var palenight_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    background: "#292d3e",
    backgroundAlt: "#1e2132",
    backgroundPanel: "#32364a",
    foreground: "#a6accd",
    foregroundBright: "#bfc7d5",
    comment: "#676e95",
    red: "#f07178",
    orange: "#f78c6c",
    yellow: "#ffcb6b",
    green: "#c3e88d",
    cyan: "#89ddff",
    blue: "#82aaff",
    purple: "#c792ea",
    magenta: "#ff5370",
    pink: "#f07178"
  },
  theme: {
    primary: {
      dark: "blue",
      light: "#4976eb"
    },
    secondary: {
      dark: "purple",
      light: "#a854f2"
    },
    accent: {
      dark: "cyan",
      light: "#00acc1"
    },
    error: {
      dark: "red",
      light: "#e53935"
    },
    warning: {
      dark: "yellow",
      light: "#ffb300"
    },
    success: {
      dark: "green",
      light: "#91b859"
    },
    info: {
      dark: "orange",
      light: "#f4511e"
    },
    text: {
      dark: "foreground",
      light: "#292d3e"
    },
    textMuted: {
      dark: "comment",
      light: "#8796b0"
    },
    background: {
      dark: "#292d3e",
      light: "#fafafa"
    },
    backgroundPanel: {
      dark: "#1e2132",
      light: "#f5f5f5"
    },
    backgroundElement: {
      dark: "#32364a",
      light: "#e7e7e8"
    },
    border: {
      dark: "#32364a",
      light: "#e0e0e0"
    },
    borderActive: {
      dark: "blue",
      light: "#4976eb"
    },
    borderSubtle: {
      dark: "#1e2132",
      light: "#eeeeee"
    },
    diffAdded: {
      dark: "green",
      light: "#91b859"
    },
    diffRemoved: {
      dark: "red",
      light: "#e53935"
    },
    diffContext: {
      dark: "comment",
      light: "#8796b0"
    },
    diffHunkHeader: {
      dark: "cyan",
      light: "#00acc1"
    },
    diffHighlightAdded: {
      dark: "green",
      light: "#91b859"
    },
    diffHighlightRemoved: {
      dark: "red",
      light: "#e53935"
    },
    diffAddedBg: {
      dark: "#2e3c2b",
      light: "#e8f5e9"
    },
    diffRemovedBg: {
      dark: "#3c2b2b",
      light: "#ffebee"
    },
    diffContextBg: {
      dark: "#1e2132",
      light: "#f5f5f5"
    },
    diffLineNumber: {
      dark: "#a0a2af",
      light: "#6a6e70"
    },
    diffAddedLineNumberBg: {
      dark: "#2e3c2b",
      light: "#e8f5e9"
    },
    diffRemovedLineNumberBg: {
      dark: "#3c2b2b",
      light: "#ffebee"
    },
    markdownText: {
      dark: "foreground",
      light: "#292d3e"
    },
    markdownHeading: {
      dark: "purple",
      light: "#a854f2"
    },
    markdownLink: {
      dark: "blue",
      light: "#4976eb"
    },
    markdownLinkText: {
      dark: "cyan",
      light: "#00acc1"
    },
    markdownCode: {
      dark: "green",
      light: "#91b859"
    },
    markdownBlockQuote: {
      dark: "comment",
      light: "#8796b0"
    },
    markdownEmph: {
      dark: "yellow",
      light: "#ffb300"
    },
    markdownStrong: {
      dark: "orange",
      light: "#f4511e"
    },
    markdownHorizontalRule: {
      dark: "comment",
      light: "#8796b0"
    },
    markdownListItem: {
      dark: "blue",
      light: "#4976eb"
    },
    markdownListEnumeration: {
      dark: "cyan",
      light: "#00acc1"
    },
    markdownImage: {
      dark: "blue",
      light: "#4976eb"
    },
    markdownImageText: {
      dark: "cyan",
      light: "#00acc1"
    },
    markdownCodeBlock: {
      dark: "foreground",
      light: "#292d3e"
    },
    syntaxComment: {
      dark: "comment",
      light: "#8796b0"
    },
    syntaxKeyword: {
      dark: "purple",
      light: "#a854f2"
    },
    syntaxFunction: {
      dark: "blue",
      light: "#4976eb"
    },
    syntaxVariable: {
      dark: "foreground",
      light: "#292d3e"
    },
    syntaxString: {
      dark: "green",
      light: "#91b859"
    },
    syntaxNumber: {
      dark: "orange",
      light: "#f4511e"
    },
    syntaxType: {
      dark: "yellow",
      light: "#ffb300"
    },
    syntaxOperator: {
      dark: "cyan",
      light: "#00acc1"
    },
    syntaxPunctuation: {
      dark: "foreground",
      light: "#292d3e"
    }
  }
};
// ../tui-base/src/theme/assets/rosepine.json
var rosepine_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    base: "#191724",
    surface: "#1f1d2e",
    overlay: "#26233a",
    muted: "#6e6a86",
    subtle: "#908caa",
    text: "#e0def4",
    love: "#eb6f92",
    gold: "#f6c177",
    rose: "#ebbcba",
    pine: "#31748f",
    foam: "#9ccfd8",
    iris: "#c4a7e7",
    highlightLow: "#21202e",
    highlightMed: "#403d52",
    highlightHigh: "#524f67",
    moonBase: "#232136",
    moonSurface: "#2a273f",
    moonOverlay: "#393552",
    moonMuted: "#6e6a86",
    moonSubtle: "#908caa",
    moonText: "#e0def4",
    dawnBase: "#faf4ed",
    dawnSurface: "#fffaf3",
    dawnOverlay: "#f2e9e1",
    dawnMuted: "#9893a5",
    dawnSubtle: "#797593",
    dawnText: "#575279"
  },
  theme: {
    primary: {
      dark: "foam",
      light: "pine"
    },
    secondary: {
      dark: "iris",
      light: "#907aa9"
    },
    accent: {
      dark: "rose",
      light: "#d7827e"
    },
    error: {
      dark: "love",
      light: "#b4637a"
    },
    warning: {
      dark: "gold",
      light: "#ea9d34"
    },
    success: {
      dark: "pine",
      light: "#286983"
    },
    info: {
      dark: "foam",
      light: "#56949f"
    },
    text: {
      dark: "#e0def4",
      light: "#575279"
    },
    textMuted: {
      dark: "muted",
      light: "dawnMuted"
    },
    background: {
      dark: "base",
      light: "dawnBase"
    },
    backgroundPanel: {
      dark: "surface",
      light: "dawnSurface"
    },
    backgroundElement: {
      dark: "overlay",
      light: "dawnOverlay"
    },
    border: {
      dark: "highlightMed",
      light: "#dfdad9"
    },
    borderActive: {
      dark: "foam",
      light: "pine"
    },
    borderSubtle: {
      dark: "highlightLow",
      light: "#f4ede8"
    },
    diffAdded: {
      dark: "pine",
      light: "#286983"
    },
    diffRemoved: {
      dark: "love",
      light: "#b4637a"
    },
    diffContext: {
      dark: "muted",
      light: "dawnMuted"
    },
    diffHunkHeader: {
      dark: "iris",
      light: "#907aa9"
    },
    diffHighlightAdded: {
      dark: "pine",
      light: "#286983"
    },
    diffHighlightRemoved: {
      dark: "love",
      light: "#b4637a"
    },
    diffAddedBg: {
      dark: "#1f2d3a",
      light: "#e5f2f3"
    },
    diffRemovedBg: {
      dark: "#3a1f2d",
      light: "#fce5e8"
    },
    diffContextBg: {
      dark: "surface",
      light: "dawnSurface"
    },
    diffLineNumber: {
      dark: "#9491a6",
      light: "#6c6875"
    },
    diffAddedLineNumberBg: {
      dark: "#1f2d3a",
      light: "#e5f2f3"
    },
    diffRemovedLineNumberBg: {
      dark: "#3a1f2d",
      light: "#fce5e8"
    },
    markdownText: {
      dark: "#e0def4",
      light: "#575279"
    },
    markdownHeading: {
      dark: "iris",
      light: "#907aa9"
    },
    markdownLink: {
      dark: "foam",
      light: "pine"
    },
    markdownLinkText: {
      dark: "rose",
      light: "#d7827e"
    },
    markdownCode: {
      dark: "pine",
      light: "#286983"
    },
    markdownBlockQuote: {
      dark: "muted",
      light: "dawnMuted"
    },
    markdownEmph: {
      dark: "gold",
      light: "#ea9d34"
    },
    markdownStrong: {
      dark: "love",
      light: "#b4637a"
    },
    markdownHorizontalRule: {
      dark: "highlightMed",
      light: "#dfdad9"
    },
    markdownListItem: {
      dark: "foam",
      light: "pine"
    },
    markdownListEnumeration: {
      dark: "rose",
      light: "#d7827e"
    },
    markdownImage: {
      dark: "foam",
      light: "pine"
    },
    markdownImageText: {
      dark: "rose",
      light: "#d7827e"
    },
    markdownCodeBlock: {
      dark: "#e0def4",
      light: "#575279"
    },
    syntaxComment: {
      dark: "muted",
      light: "dawnMuted"
    },
    syntaxKeyword: {
      dark: "pine",
      light: "#286983"
    },
    syntaxFunction: {
      dark: "rose",
      light: "#d7827e"
    },
    syntaxVariable: {
      dark: "#e0def4",
      light: "#575279"
    },
    syntaxString: {
      dark: "gold",
      light: "#ea9d34"
    },
    syntaxNumber: {
      dark: "iris",
      light: "#907aa9"
    },
    syntaxType: {
      dark: "foam",
      light: "#56949f"
    },
    syntaxOperator: {
      dark: "subtle",
      light: "dawnSubtle"
    },
    syntaxPunctuation: {
      dark: "subtle",
      light: "dawnSubtle"
    }
  }
};
// ../tui-base/src/theme/assets/solarized.json
var solarized_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    base03: "#002b36",
    base02: "#073642",
    base01: "#586e75",
    base00: "#657b83",
    base0: "#839496",
    base1: "#93a1a1",
    base2: "#eee8d5",
    base3: "#fdf6e3",
    yellow: "#b58900",
    orange: "#cb4b16",
    red: "#dc322f",
    magenta: "#d33682",
    violet: "#6c71c4",
    blue: "#268bd2",
    cyan: "#2aa198",
    green: "#859900"
  },
  theme: {
    primary: {
      dark: "blue",
      light: "blue"
    },
    secondary: {
      dark: "violet",
      light: "violet"
    },
    accent: {
      dark: "cyan",
      light: "cyan"
    },
    error: {
      dark: "red",
      light: "red"
    },
    warning: {
      dark: "yellow",
      light: "yellow"
    },
    success: {
      dark: "green",
      light: "green"
    },
    info: {
      dark: "orange",
      light: "orange"
    },
    text: {
      dark: "base0",
      light: "base00"
    },
    textMuted: {
      dark: "base01",
      light: "base1"
    },
    background: {
      dark: "base03",
      light: "base3"
    },
    backgroundPanel: {
      dark: "base02",
      light: "base2"
    },
    backgroundElement: {
      dark: "#073642",
      light: "#eee8d5"
    },
    border: {
      dark: "base02",
      light: "base2"
    },
    borderActive: {
      dark: "base01",
      light: "base1"
    },
    borderSubtle: {
      dark: "#073642",
      light: "#eee8d5"
    },
    diffAdded: {
      dark: "green",
      light: "green"
    },
    diffRemoved: {
      dark: "red",
      light: "red"
    },
    diffContext: {
      dark: "base01",
      light: "base1"
    },
    diffHunkHeader: {
      dark: "base01",
      light: "base1"
    },
    diffHighlightAdded: {
      dark: "green",
      light: "green"
    },
    diffHighlightRemoved: {
      dark: "red",
      light: "red"
    },
    diffAddedBg: {
      dark: "#073642",
      light: "#eee8d5"
    },
    diffRemovedBg: {
      dark: "#073642",
      light: "#eee8d5"
    },
    diffContextBg: {
      dark: "base02",
      light: "base2"
    },
    diffLineNumber: {
      dark: "#8b9b9f",
      light: "#5f6969"
    },
    diffAddedLineNumberBg: {
      dark: "#073642",
      light: "#eee8d5"
    },
    diffRemovedLineNumberBg: {
      dark: "#073642",
      light: "#eee8d5"
    },
    markdownText: {
      dark: "base0",
      light: "base00"
    },
    markdownHeading: {
      dark: "blue",
      light: "blue"
    },
    markdownLink: {
      dark: "cyan",
      light: "cyan"
    },
    markdownLinkText: {
      dark: "violet",
      light: "violet"
    },
    markdownCode: {
      dark: "green",
      light: "green"
    },
    markdownBlockQuote: {
      dark: "base01",
      light: "base1"
    },
    markdownEmph: {
      dark: "yellow",
      light: "yellow"
    },
    markdownStrong: {
      dark: "orange",
      light: "orange"
    },
    markdownHorizontalRule: {
      dark: "base01",
      light: "base1"
    },
    markdownListItem: {
      dark: "blue",
      light: "blue"
    },
    markdownListEnumeration: {
      dark: "cyan",
      light: "cyan"
    },
    markdownImage: {
      dark: "cyan",
      light: "cyan"
    },
    markdownImageText: {
      dark: "violet",
      light: "violet"
    },
    markdownCodeBlock: {
      dark: "base0",
      light: "base00"
    },
    syntaxComment: {
      dark: "base01",
      light: "base1"
    },
    syntaxKeyword: {
      dark: "green",
      light: "green"
    },
    syntaxFunction: {
      dark: "blue",
      light: "blue"
    },
    syntaxVariable: {
      dark: "cyan",
      light: "cyan"
    },
    syntaxString: {
      dark: "cyan",
      light: "cyan"
    },
    syntaxNumber: {
      dark: "magenta",
      light: "magenta"
    },
    syntaxType: {
      dark: "yellow",
      light: "yellow"
    },
    syntaxOperator: {
      dark: "green",
      light: "green"
    },
    syntaxPunctuation: {
      dark: "base0",
      light: "base00"
    }
  }
};
// ../tui-base/src/theme/assets/synthwave84.json
var synthwave84_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    background: "#262335",
    backgroundAlt: "#1e1a29",
    backgroundPanel: "#2a2139",
    foreground: "#ffffff",
    foregroundMuted: "#848bbd",
    pink: "#ff7edb",
    pinkBright: "#ff92df",
    cyan: "#36f9f6",
    cyanBright: "#72f1f8",
    yellow: "#fede5d",
    yellowBright: "#fff95d",
    orange: "#ff8b39",
    orangeBright: "#ff9f43",
    purple: "#b084eb",
    purpleBright: "#c792ea",
    red: "#fe4450",
    redBright: "#ff5e5b",
    green: "#72f1b8",
    greenBright: "#97f1d8"
  },
  theme: {
    primary: {
      dark: "cyan",
      light: "#00bcd4"
    },
    secondary: {
      dark: "pink",
      light: "#e91e63"
    },
    accent: {
      dark: "purple",
      light: "#9c27b0"
    },
    error: {
      dark: "red",
      light: "#f44336"
    },
    warning: {
      dark: "yellow",
      light: "#ff9800"
    },
    success: {
      dark: "green",
      light: "#4caf50"
    },
    info: {
      dark: "orange",
      light: "#ff5722"
    },
    text: {
      dark: "foreground",
      light: "#262335"
    },
    textMuted: {
      dark: "foregroundMuted",
      light: "#5c5c8a"
    },
    background: {
      dark: "#262335",
      light: "#fafafa"
    },
    backgroundPanel: {
      dark: "#1e1a29",
      light: "#f5f5f5"
    },
    backgroundElement: {
      dark: "#2a2139",
      light: "#eeeeee"
    },
    border: {
      dark: "#495495",
      light: "#e0e0e0"
    },
    borderActive: {
      dark: "cyan",
      light: "#00bcd4"
    },
    borderSubtle: {
      dark: "#241b2f",
      light: "#f0f0f0"
    },
    diffAdded: {
      dark: "green",
      light: "#4caf50"
    },
    diffRemoved: {
      dark: "red",
      light: "#f44336"
    },
    diffContext: {
      dark: "foregroundMuted",
      light: "#5c5c8a"
    },
    diffHunkHeader: {
      dark: "purple",
      light: "#9c27b0"
    },
    diffHighlightAdded: {
      dark: "greenBright",
      light: "#4caf50"
    },
    diffHighlightRemoved: {
      dark: "redBright",
      light: "#f44336"
    },
    diffAddedBg: {
      dark: "#1a3a2a",
      light: "#e8f5e9"
    },
    diffRemovedBg: {
      dark: "#3a1a2a",
      light: "#ffebee"
    },
    diffContextBg: {
      dark: "#1e1a29",
      light: "#f5f5f5"
    },
    diffLineNumber: {
      dark: "#959bc1",
      light: "textMuted"
    },
    diffAddedLineNumberBg: {
      dark: "#1a3a2a",
      light: "#e8f5e9"
    },
    diffRemovedLineNumberBg: {
      dark: "#3a1a2a",
      light: "#ffebee"
    },
    markdownText: {
      dark: "foreground",
      light: "#262335"
    },
    markdownHeading: {
      dark: "pink",
      light: "#e91e63"
    },
    markdownLink: {
      dark: "cyan",
      light: "#00bcd4"
    },
    markdownLinkText: {
      dark: "purple",
      light: "#9c27b0"
    },
    markdownCode: {
      dark: "green",
      light: "#4caf50"
    },
    markdownBlockQuote: {
      dark: "foregroundMuted",
      light: "#5c5c8a"
    },
    markdownEmph: {
      dark: "yellow",
      light: "#ff9800"
    },
    markdownStrong: {
      dark: "orange",
      light: "#ff5722"
    },
    markdownHorizontalRule: {
      dark: "#495495",
      light: "#e0e0e0"
    },
    markdownListItem: {
      dark: "cyan",
      light: "#00bcd4"
    },
    markdownListEnumeration: {
      dark: "purple",
      light: "#9c27b0"
    },
    markdownImage: {
      dark: "cyan",
      light: "#00bcd4"
    },
    markdownImageText: {
      dark: "purple",
      light: "#9c27b0"
    },
    markdownCodeBlock: {
      dark: "foreground",
      light: "#262335"
    },
    syntaxComment: {
      dark: "foregroundMuted",
      light: "#5c5c8a"
    },
    syntaxKeyword: {
      dark: "pink",
      light: "#e91e63"
    },
    syntaxFunction: {
      dark: "orange",
      light: "#ff5722"
    },
    syntaxVariable: {
      dark: "foreground",
      light: "#262335"
    },
    syntaxString: {
      dark: "yellow",
      light: "#ff9800"
    },
    syntaxNumber: {
      dark: "purple",
      light: "#9c27b0"
    },
    syntaxType: {
      dark: "cyan",
      light: "#00bcd4"
    },
    syntaxOperator: {
      dark: "pink",
      light: "#e91e63"
    },
    syntaxPunctuation: {
      dark: "foreground",
      light: "#262335"
    }
  }
};
// ../tui-base/src/theme/assets/tokyonight.json
var tokyonight_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    darkStep1: "#1a1b26",
    darkStep2: "#1e2030",
    darkStep3: "#222436",
    darkStep4: "#292e42",
    darkStep5: "#3b4261",
    darkStep6: "#545c7e",
    darkStep7: "#737aa2",
    darkStep8: "#9099b2",
    darkStep9: "#82aaff",
    darkStep10: "#89b4fa",
    darkStep11: "#828bb8",
    darkStep12: "#c8d3f5",
    darkRed: "#ff757f",
    darkOrange: "#ff966c",
    darkYellow: "#ffc777",
    darkGreen: "#c3e88d",
    darkCyan: "#86e1fc",
    darkPurple: "#c099ff",
    lightStep1: "#e1e2e7",
    lightStep2: "#d5d6db",
    lightStep3: "#c8c9ce",
    lightStep4: "#b9bac1",
    lightStep5: "#a8aecb",
    lightStep6: "#9699a8",
    lightStep7: "#737a8c",
    lightStep8: "#5a607d",
    lightStep9: "#2e7de9",
    lightStep10: "#1a6ce7",
    lightStep11: "#8990a3",
    lightStep12: "#3760bf",
    lightRed: "#f52a65",
    lightOrange: "#b15c00",
    lightYellow: "#8c6c3e",
    lightGreen: "#587539",
    lightCyan: "#007197",
    lightPurple: "#9854f1"
  },
  theme: {
    primary: {
      dark: "darkStep9",
      light: "lightStep9"
    },
    secondary: {
      dark: "darkPurple",
      light: "lightPurple"
    },
    accent: {
      dark: "darkOrange",
      light: "lightOrange"
    },
    error: {
      dark: "darkRed",
      light: "lightRed"
    },
    warning: {
      dark: "darkOrange",
      light: "lightOrange"
    },
    success: {
      dark: "darkGreen",
      light: "lightGreen"
    },
    info: {
      dark: "darkStep9",
      light: "lightStep9"
    },
    text: {
      dark: "darkStep12",
      light: "lightStep12"
    },
    textMuted: {
      dark: "darkStep11",
      light: "lightStep11"
    },
    background: {
      dark: "darkStep1",
      light: "lightStep1"
    },
    backgroundPanel: {
      dark: "darkStep2",
      light: "lightStep2"
    },
    backgroundElement: {
      dark: "darkStep3",
      light: "lightStep3"
    },
    border: {
      dark: "darkStep7",
      light: "lightStep7"
    },
    borderActive: {
      dark: "darkStep8",
      light: "lightStep8"
    },
    borderSubtle: {
      dark: "darkStep6",
      light: "lightStep6"
    },
    diffAdded: {
      dark: "#4fd6be",
      light: "#1e725c"
    },
    diffRemoved: {
      dark: "#c53b53",
      light: "#c53b53"
    },
    diffContext: {
      dark: "#828bb8",
      light: "#7086b5"
    },
    diffHunkHeader: {
      dark: "#828bb8",
      light: "#7086b5"
    },
    diffHighlightAdded: {
      dark: "#b8db87",
      light: "#4db380"
    },
    diffHighlightRemoved: {
      dark: "#e26a75",
      light: "#f52a65"
    },
    diffAddedBg: {
      dark: "#20303b",
      light: "#d5e5d5"
    },
    diffRemovedBg: {
      dark: "#37222c",
      light: "#f7d8db"
    },
    diffContextBg: {
      dark: "darkStep2",
      light: "lightStep2"
    },
    diffLineNumber: {
      dark: "#8f909a",
      light: "#59595b"
    },
    diffAddedLineNumberBg: {
      dark: "#1b2b34",
      light: "#c5d5c5"
    },
    diffRemovedLineNumberBg: {
      dark: "#2d1f26",
      light: "#e7c8cb"
    },
    markdownText: {
      dark: "darkStep12",
      light: "lightStep12"
    },
    markdownHeading: {
      dark: "darkPurple",
      light: "lightPurple"
    },
    markdownLink: {
      dark: "darkStep9",
      light: "lightStep9"
    },
    markdownLinkText: {
      dark: "darkCyan",
      light: "lightCyan"
    },
    markdownCode: {
      dark: "darkGreen",
      light: "lightGreen"
    },
    markdownBlockQuote: {
      dark: "darkYellow",
      light: "lightYellow"
    },
    markdownEmph: {
      dark: "darkYellow",
      light: "lightYellow"
    },
    markdownStrong: {
      dark: "darkOrange",
      light: "lightOrange"
    },
    markdownHorizontalRule: {
      dark: "darkStep11",
      light: "lightStep11"
    },
    markdownListItem: {
      dark: "darkStep9",
      light: "lightStep9"
    },
    markdownListEnumeration: {
      dark: "darkCyan",
      light: "lightCyan"
    },
    markdownImage: {
      dark: "darkStep9",
      light: "lightStep9"
    },
    markdownImageText: {
      dark: "darkCyan",
      light: "lightCyan"
    },
    markdownCodeBlock: {
      dark: "darkStep12",
      light: "lightStep12"
    },
    syntaxComment: {
      dark: "darkStep11",
      light: "lightStep11"
    },
    syntaxKeyword: {
      dark: "darkPurple",
      light: "lightPurple"
    },
    syntaxFunction: {
      dark: "darkStep9",
      light: "lightStep9"
    },
    syntaxVariable: {
      dark: "darkRed",
      light: "lightRed"
    },
    syntaxString: {
      dark: "darkGreen",
      light: "lightGreen"
    },
    syntaxNumber: {
      dark: "darkOrange",
      light: "lightOrange"
    },
    syntaxType: {
      dark: "darkYellow",
      light: "lightYellow"
    },
    syntaxOperator: {
      dark: "darkCyan",
      light: "lightCyan"
    },
    syntaxPunctuation: {
      dark: "darkStep12",
      light: "lightStep12"
    }
  }
};
// ../tui-base/src/theme/assets/vercel.json
var vercel_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    background100: "#0A0A0A",
    background200: "#000000",
    gray100: "#1A1A1A",
    gray200: "#1F1F1F",
    gray300: "#292929",
    gray400: "#2E2E2E",
    gray500: "#454545",
    gray600: "#878787",
    gray700: "#8F8F8F",
    gray900: "#A1A1A1",
    gray1000: "#EDEDED",
    blue600: "#0099FF",
    blue700: "#0070F3",
    blue900: "#52A8FF",
    blue1000: "#EBF8FF",
    red700: "#E5484D",
    red900: "#FF6166",
    red1000: "#FDECED",
    amber700: "#FFB224",
    amber900: "#F2A700",
    amber1000: "#FDF4DC",
    green700: "#46A758",
    green900: "#63C46D",
    green1000: "#E6F9E9",
    teal700: "#12A594",
    teal900: "#0AC7AC",
    purple700: "#8E4EC6",
    purple900: "#BF7AF0",
    pink700: "#E93D82",
    pink900: "#F75590",
    highlightPink: "#FF0080",
    highlightPurple: "#F81CE5",
    cyan: "#50E3C2",
    lightBackground: "#FFFFFF",
    lightGray100: "#FAFAFA",
    lightGray200: "#EAEAEA",
    lightGray600: "#666666",
    lightGray1000: "#171717"
  },
  theme: {
    primary: {
      dark: "blue700",
      light: "blue700"
    },
    secondary: {
      dark: "blue900",
      light: "#0062D1"
    },
    accent: {
      dark: "purple700",
      light: "purple700"
    },
    error: {
      dark: "red700",
      light: "#DC3545"
    },
    warning: {
      dark: "amber700",
      light: "#FF9500"
    },
    success: {
      dark: "green700",
      light: "#388E3C"
    },
    info: {
      dark: "blue900",
      light: "blue700"
    },
    text: {
      dark: "gray1000",
      light: "lightGray1000"
    },
    textMuted: {
      dark: "gray600",
      light: "lightGray600"
    },
    background: {
      dark: "background200",
      light: "lightBackground"
    },
    backgroundPanel: {
      dark: "gray100",
      light: "lightGray100"
    },
    backgroundElement: {
      dark: "gray300",
      light: "lightGray200"
    },
    border: {
      dark: "gray200",
      light: "lightGray200"
    },
    borderActive: {
      dark: "gray500",
      light: "#999999"
    },
    borderSubtle: {
      dark: "gray100",
      light: "#EAEAEA"
    },
    diffAdded: {
      dark: "green900",
      light: "green700"
    },
    diffRemoved: {
      dark: "red900",
      light: "red700"
    },
    diffContext: {
      dark: "gray600",
      light: "lightGray600"
    },
    diffHunkHeader: {
      dark: "gray600",
      light: "lightGray600"
    },
    diffHighlightAdded: {
      dark: "green900",
      light: "green700"
    },
    diffHighlightRemoved: {
      dark: "red900",
      light: "red700"
    },
    diffAddedBg: {
      dark: "#0B1D0F",
      light: "#E6F9E9"
    },
    diffRemovedBg: {
      dark: "#2A1314",
      light: "#FDECED"
    },
    diffContextBg: {
      dark: "background200",
      light: "lightBackground"
    },
    diffLineNumber: {
      dark: "#8a8a8a",
      light: "textMuted"
    },
    diffAddedLineNumberBg: {
      dark: "#0F2613",
      light: "#D6F5D6"
    },
    diffRemovedLineNumberBg: {
      dark: "#3C1618",
      light: "#FFE5E5"
    },
    markdownText: {
      dark: "gray1000",
      light: "lightGray1000"
    },
    markdownHeading: {
      dark: "purple900",
      light: "purple700"
    },
    markdownLink: {
      dark: "blue900",
      light: "blue700"
    },
    markdownLinkText: {
      dark: "teal900",
      light: "teal700"
    },
    markdownCode: {
      dark: "green900",
      light: "green700"
    },
    markdownBlockQuote: {
      dark: "gray600",
      light: "lightGray600"
    },
    markdownEmph: {
      dark: "amber900",
      light: "amber700"
    },
    markdownStrong: {
      dark: "pink900",
      light: "pink700"
    },
    markdownHorizontalRule: {
      dark: "gray500",
      light: "#999999"
    },
    markdownListItem: {
      dark: "gray1000",
      light: "lightGray1000"
    },
    markdownListEnumeration: {
      dark: "blue900",
      light: "blue700"
    },
    markdownImage: {
      dark: "teal900",
      light: "teal700"
    },
    markdownImageText: {
      dark: "cyan",
      light: "teal700"
    },
    markdownCodeBlock: {
      dark: "gray1000",
      light: "lightGray1000"
    },
    syntaxComment: {
      dark: "gray600",
      light: "#888888"
    },
    syntaxKeyword: {
      dark: "pink900",
      light: "pink700"
    },
    syntaxFunction: {
      dark: "purple900",
      light: "purple700"
    },
    syntaxVariable: {
      dark: "blue900",
      light: "blue700"
    },
    syntaxString: {
      dark: "green900",
      light: "green700"
    },
    syntaxNumber: {
      dark: "amber900",
      light: "amber700"
    },
    syntaxType: {
      dark: "teal900",
      light: "teal700"
    },
    syntaxOperator: {
      dark: "pink900",
      light: "pink700"
    },
    syntaxPunctuation: {
      dark: "gray1000",
      light: "lightGray1000"
    }
  }
};
// ../tui-base/src/theme/assets/vesper.json
var vesper_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    vesperBg: "#101010",
    vesperFg: "#FFF",
    vesperComment: "#8b8b8b",
    vesperKeyword: "#A0A0A0",
    vesperFunction: "#FFC799",
    vesperString: "#99FFE4",
    vesperNumber: "#FFC799",
    vesperError: "#FF8080",
    vesperWarning: "#FFC799",
    vesperSuccess: "#99FFE4",
    vesperMuted: "#A0A0A0"
  },
  theme: {
    primary: {
      dark: "#FFC799",
      light: "#FFC799"
    },
    secondary: {
      dark: "#99FFE4",
      light: "#99FFE4"
    },
    accent: {
      dark: "#FFC799",
      light: "#FFC799"
    },
    error: {
      dark: "vesperError",
      light: "vesperError"
    },
    warning: {
      dark: "vesperWarning",
      light: "vesperWarning"
    },
    success: {
      dark: "vesperSuccess",
      light: "vesperSuccess"
    },
    info: {
      dark: "#FFC799",
      light: "#FFC799"
    },
    text: {
      dark: "vesperFg",
      light: "vesperBg"
    },
    textMuted: {
      dark: "vesperMuted",
      light: "vesperMuted"
    },
    background: {
      dark: "vesperBg",
      light: "#FFF"
    },
    backgroundPanel: {
      dark: "vesperBg",
      light: "#F0F0F0"
    },
    backgroundElement: {
      dark: "vesperBg",
      light: "#E0E0E0"
    },
    border: {
      dark: "#282828",
      light: "#D0D0D0"
    },
    borderActive: {
      dark: "#FFC799",
      light: "#FFC799"
    },
    borderSubtle: {
      dark: "#1C1C1C",
      light: "#E8E8E8"
    },
    diffAdded: {
      dark: "vesperSuccess",
      light: "vesperSuccess"
    },
    diffRemoved: {
      dark: "vesperError",
      light: "vesperError"
    },
    diffContext: {
      dark: "vesperMuted",
      light: "vesperMuted"
    },
    diffHunkHeader: {
      dark: "vesperMuted",
      light: "vesperMuted"
    },
    diffHighlightAdded: {
      dark: "vesperSuccess",
      light: "vesperSuccess"
    },
    diffHighlightRemoved: {
      dark: "vesperError",
      light: "vesperError"
    },
    diffAddedBg: {
      dark: "#0d2818",
      light: "#e8f5e8"
    },
    diffRemovedBg: {
      dark: "#281a1a",
      light: "#f5e8e8"
    },
    diffContextBg: {
      dark: "vesperBg",
      light: "#F8F8F8"
    },
    diffLineNumber: {
      dark: "textMuted",
      light: "#6a6a6a"
    },
    diffAddedLineNumberBg: {
      dark: "#0d2818",
      light: "#e8f5e8"
    },
    diffRemovedLineNumberBg: {
      dark: "#281a1a",
      light: "#f5e8e8"
    },
    markdownText: {
      dark: "vesperFg",
      light: "vesperBg"
    },
    markdownHeading: {
      dark: "#FFC799",
      light: "#FFC799"
    },
    markdownLink: {
      dark: "#FFC799",
      light: "#FFC799"
    },
    markdownLinkText: {
      dark: "vesperMuted",
      light: "vesperMuted"
    },
    markdownCode: {
      dark: "vesperMuted",
      light: "vesperMuted"
    },
    markdownBlockQuote: {
      dark: "vesperFg",
      light: "vesperBg"
    },
    markdownEmph: {
      dark: "vesperFg",
      light: "vesperBg"
    },
    markdownStrong: {
      dark: "vesperFg",
      light: "vesperBg"
    },
    markdownHorizontalRule: {
      dark: "#65737E",
      light: "#65737E"
    },
    markdownListItem: {
      dark: "vesperFg",
      light: "vesperBg"
    },
    markdownListEnumeration: {
      dark: "vesperFg",
      light: "vesperBg"
    },
    markdownImage: {
      dark: "#FFC799",
      light: "#FFC799"
    },
    markdownImageText: {
      dark: "vesperMuted",
      light: "vesperMuted"
    },
    markdownCodeBlock: {
      dark: "vesperFg",
      light: "vesperBg"
    },
    syntaxComment: {
      dark: "vesperComment",
      light: "vesperComment"
    },
    syntaxKeyword: {
      dark: "vesperKeyword",
      light: "vesperKeyword"
    },
    syntaxFunction: {
      dark: "vesperFunction",
      light: "vesperFunction"
    },
    syntaxVariable: {
      dark: "vesperFg",
      light: "vesperBg"
    },
    syntaxString: {
      dark: "vesperString",
      light: "vesperString"
    },
    syntaxNumber: {
      dark: "vesperNumber",
      light: "vesperNumber"
    },
    syntaxType: {
      dark: "vesperFunction",
      light: "vesperFunction"
    },
    syntaxOperator: {
      dark: "vesperKeyword",
      light: "vesperKeyword"
    },
    syntaxPunctuation: {
      dark: "vesperFg",
      light: "vesperBg"
    }
  }
};
// ../tui-base/src/theme/assets/zenburn.json
var zenburn_default = {
  $schema: "https://opencode.ai/theme.json",
  defs: {
    bg: "#3f3f3f",
    bgAlt: "#4f4f4f",
    bgPanel: "#5f5f5f",
    fg: "#dcdccc",
    fgMuted: "#9f9f9f",
    red: "#cc9393",
    redBright: "#dca3a3",
    green: "#7f9f7f",
    greenBright: "#8fb28f",
    yellow: "#f0dfaf",
    yellowDim: "#e0cf9f",
    blue: "#8cd0d3",
    blueDim: "#7cb8bb",
    magenta: "#dc8cc3",
    cyan: "#93e0e3",
    orange: "#dfaf8f"
  },
  theme: {
    primary: {
      dark: "blue",
      light: "#5f7f8f"
    },
    secondary: {
      dark: "magenta",
      light: "#8f5f8f"
    },
    accent: {
      dark: "cyan",
      light: "#5f8f8f"
    },
    error: {
      dark: "red",
      light: "#8f5f5f"
    },
    warning: {
      dark: "yellow",
      light: "#8f8f5f"
    },
    success: {
      dark: "green",
      light: "#5f8f5f"
    },
    info: {
      dark: "orange",
      light: "#8f7f5f"
    },
    text: {
      dark: "fg",
      light: "#3f3f3f"
    },
    textMuted: {
      dark: "fgMuted",
      light: "#6f6f6f"
    },
    background: {
      dark: "bg",
      light: "#ffffef"
    },
    backgroundPanel: {
      dark: "bgAlt",
      light: "#f5f5e5"
    },
    backgroundElement: {
      dark: "bgPanel",
      light: "#ebebdb"
    },
    border: {
      dark: "#5f5f5f",
      light: "#d0d0c0"
    },
    borderActive: {
      dark: "blue",
      light: "#5f7f8f"
    },
    borderSubtle: {
      dark: "#4f4f4f",
      light: "#e0e0d0"
    },
    diffAdded: {
      dark: "green",
      light: "#5f8f5f"
    },
    diffRemoved: {
      dark: "red",
      light: "#8f5f5f"
    },
    diffContext: {
      dark: "fgMuted",
      light: "#6f6f6f"
    },
    diffHunkHeader: {
      dark: "cyan",
      light: "#5f8f8f"
    },
    diffHighlightAdded: {
      dark: "greenBright",
      light: "#5f8f5f"
    },
    diffHighlightRemoved: {
      dark: "redBright",
      light: "#8f5f5f"
    },
    diffAddedBg: {
      dark: "#4f5f4f",
      light: "#efffef"
    },
    diffRemovedBg: {
      dark: "#5f4f4f",
      light: "#ffefef"
    },
    diffContextBg: {
      dark: "bgAlt",
      light: "#f5f5e5"
    },
    diffLineNumber: {
      dark: "#d2d2d2",
      light: "textMuted"
    },
    diffAddedLineNumberBg: {
      dark: "#4f5f4f",
      light: "#efffef"
    },
    diffRemovedLineNumberBg: {
      dark: "#5f4f4f",
      light: "#ffefef"
    },
    markdownText: {
      dark: "fg",
      light: "#3f3f3f"
    },
    markdownHeading: {
      dark: "yellow",
      light: "#8f8f5f"
    },
    markdownLink: {
      dark: "blue",
      light: "#5f7f8f"
    },
    markdownLinkText: {
      dark: "cyan",
      light: "#5f8f8f"
    },
    markdownCode: {
      dark: "green",
      light: "#5f8f5f"
    },
    markdownBlockQuote: {
      dark: "fgMuted",
      light: "#6f6f6f"
    },
    markdownEmph: {
      dark: "yellowDim",
      light: "#8f8f5f"
    },
    markdownStrong: {
      dark: "orange",
      light: "#8f7f5f"
    },
    markdownHorizontalRule: {
      dark: "fgMuted",
      light: "#6f6f6f"
    },
    markdownListItem: {
      dark: "blue",
      light: "#5f7f8f"
    },
    markdownListEnumeration: {
      dark: "cyan",
      light: "#5f8f8f"
    },
    markdownImage: {
      dark: "blue",
      light: "#5f7f8f"
    },
    markdownImageText: {
      dark: "cyan",
      light: "#5f8f8f"
    },
    markdownCodeBlock: {
      dark: "fg",
      light: "#3f3f3f"
    },
    syntaxComment: {
      dark: "#7f9f7f",
      light: "#5f7f5f"
    },
    syntaxKeyword: {
      dark: "yellow",
      light: "#8f8f5f"
    },
    syntaxFunction: {
      dark: "blue",
      light: "#5f7f8f"
    },
    syntaxVariable: {
      dark: "fg",
      light: "#3f3f3f"
    },
    syntaxString: {
      dark: "red",
      light: "#8f5f5f"
    },
    syntaxNumber: {
      dark: "greenBright",
      light: "#5f8f5f"
    },
    syntaxType: {
      dark: "cyan",
      light: "#5f8f8f"
    },
    syntaxOperator: {
      dark: "yellow",
      light: "#8f8f5f"
    },
    syntaxPunctuation: {
      dark: "fg",
      light: "#3f3f3f"
    }
  }
};

// ../tui-base/src/theme/v1.ts
var DEFAULT_THEMES = {
  aura: aura_default,
  ayu: ayu_default,
  catppuccin: catppuccin_default,
  ["catppuccin-frappe"]: catppuccin_frappe_default,
  ["catppuccin-macchiato"]: catppuccin_macchiato_default,
  cobalt2: cobalt2_default,
  cursor: cursor_default,
  dracula: dracula_default,
  everforest: everforest_default,
  flexoki: flexoki_default,
  github: github_default,
  gruvbox: gruvbox_default,
  kanagawa: kanagawa_default,
  material: material_default,
  matrix: matrix_default,
  mercury: mercury_default,
  monokai: monokai_default,
  nightowl: nightowl_default,
  nord: nord_default,
  ["one-dark"]: one_dark_default,
  ["osaka-jade"]: osaka_jade_default,
  orng: orng_default,
  ["lucent-orng"]: lucent_orng_default,
  palenight: palenight_default,
  rosepine: rosepine_default,
  solarized: solarized_default,
  synthwave84: synthwave84_default,
  tokyonight: tokyonight_default,
  vesper: vesper_default,
  vercel: vercel_default,
  zenburn: zenburn_default,
  carbonfox: carbonfox_default
};
// ../tui-base/src/theme/assets/v2/opencode.json
var opencode_default = {
  $schema: "https://opencode.ai/theme.json",
  base: {
    categorical: [
      "blue",
      "purple",
      "green",
      "orange",
      "red"
    ],
    text: {
      base: "$hue.neutral.200",
      muted: "$hue.neutral.400",
      action: {
        primary: {
          base: "$text.base",
          $disabled: "$hue.neutral.400",
          $focused: "$hue.neutral.800",
          $selected: "$hue.interactive.200"
        },
        secondary: {
          base: "$text.muted",
          $hovered: "$text.base"
        },
        destructive: {
          base: "$hue.neutral.800",
          $disabled: "$hue.neutral.400"
        }
      },
      formfield: {
        base: "$hue.neutral.200",
        $hovered: "$hue.interactive.200",
        $focused: "$hue.interactive.200",
        $pressed: "$hue.interactive.200",
        $disabled: "$hue.neutral.400",
        $selected: "$hue.interactive.200"
      },
      feedback: {
        error: {
          base: "$hue.red.200"
        },
        warning: {
          base: "#f5a742"
        },
        success: {
          base: "$hue.green.200"
        },
        info: {
          base: "$hue.cyan.200"
        }
      }
    },
    background: {
      base: "$hue.neutral.800",
      raised: {
        base: "$hue.neutral.700",
        high: "$hue.neutral.600",
        max: "$hue.neutral.500"
      },
      action: {
        primary: {
          base: "transparent",
          $hovered: "$hue.neutral.700",
          $focused: "$hue.interactive.200",
          $selected: "transparent"
        },
        secondary: {
          base: "transparent"
        },
        destructive: {
          base: "$hue.red.200"
        }
      },
      formfield: {
        base: "$background.base"
      },
      feedback: {
        error: {
          base: "$background.base"
        },
        warning: {
          base: "$background.base"
        },
        success: {
          base: "$background.base"
        },
        info: {
          base: "$background.base"
        }
      }
    },
    border: {
      base: "#484848"
    },
    scrollbar: {
      base: "#606060"
    },
    diff: {
      text: {
        added: "#4fd6be",
        removed: "#c53b53",
        context: "#828bb8",
        hunkHeader: "#828bb8"
      },
      background: {
        added: "#20303b",
        removed: "#37222c",
        context: "$hue.neutral.700"
      },
      highlight: {
        added: "#b8db87",
        removed: "#e26a75"
      },
      lineNumber: {
        text: "#8f8f8f",
        background: {
          added: "#1b2b34",
          removed: "#2d1f26"
        }
      }
    },
    syntax: {
      comment: "$hue.neutral.400",
      keyword: "$hue.accent.200",
      function: "$hue.interactive.200",
      variable: "$hue.red.200",
      string: "$hue.green.200",
      number: "#f5a742",
      type: "#e5c07b",
      operator: "$hue.cyan.200",
      punctuation: "$hue.neutral.200"
    },
    markdown: {
      text: "$hue.neutral.200",
      heading: "$hue.accent.200",
      link: "$hue.interactive.200",
      linkText: "$hue.cyan.200",
      code: "$hue.green.200",
      blockQuote: "#e5c07b",
      emphasis: "#e5c07b",
      strong: "#f5a742",
      horizontalRule: "$hue.neutral.400",
      listItem: "$hue.interactive.200",
      listEnumeration: "$hue.cyan.200",
      image: "$hue.interactive.200",
      imageText: "$hue.cyan.200",
      codeBlock: "$hue.neutral.200"
    },
    "@dialog": {
      background: {
        base: "$background.raised.base",
        action: {
          primary: {
            $hovered: "$background.raised.high"
          }
        }
      }
    }
  },
  light: {
    hue: {
      gray: {
        "100": "#000000",
        "200": "#1a1a1a",
        "300": "#4e4e4e",
        "400": "#8a8a8a",
        "500": "#bebebe",
        "600": "#f5f5f5",
        "700": "#fafafa",
        "800": "#ffffff",
        "900": "#ffffff"
      },
      red: {
        "100": "#c20f26",
        "200": "#d1383d",
        "300": "#e05352",
        "400": "#ee6b68",
        "500": "#fc837d",
        "600": "#fda19b",
        "700": "#fcbeb9",
        "800": "#fed8d5",
        "900": "#fff2f0"
      },
      orange: {
        "100": "#c7811e",
        "200": "#d68c27",
        "300": "#df9a44",
        "400": "#e8a85c",
        "500": "#f1b671",
        "600": "#fac386",
        "700": "#fcd4a8",
        "800": "#fee3c7",
        "900": "#fef3e7"
      },
      green: {
        "100": "#1f8c44",
        "200": "#3d9a57",
        "300": "#55a96a",
        "400": "#6cb77c",
        "500": "#81c68f",
        "600": "#96d5a3",
        "700": "#ace4b6",
        "800": "#c1f3ca",
        "900": "#e1fee6"
      },
      cyan: {
        "100": "#077786",
        "200": "#318795",
        "300": "#4c97a4",
        "400": "#64a8b4",
        "500": "#7bb8c4",
        "600": "#92c9d4",
        "700": "#a8dbe4",
        "800": "#bfecf4",
        "900": "#e3fafe"
      },
      blue: {
        "100": "#226bcc",
        "200": "#3b7dd8",
        "300": "#518ee4",
        "400": "#67a0f0",
        "500": "#7db1fc",
        "600": "#9cc3fa",
        "700": "#b7d4fd",
        "800": "#d4e5fd",
        "900": "#f0f6fe"
      },
      purple: {
        "100": "#6b47a7",
        "200": "#7b5bb6",
        "300": "#8c6fc5",
        "400": "#9d83d4",
        "500": "#af98e3",
        "600": "#c1acf2",
        "700": "#d3c3fc",
        "800": "#e4dbfd",
        "900": "#f6f3ff"
      },
      accent: "$hue.orange",
      interactive: "$hue.blue",
      neutral: "$hue.gray"
    },
    categorical: [
      "purple",
      "orange",
      "green",
      "blue",
      "red"
    ],
    text: {
      action: {
        primary: {
          $focused: "$hue.neutral.900"
        },
        destructive: {
          base: "$hue.neutral.900"
        }
      },
      feedback: {
        warning: {
          base: "$hue.accent.200"
        }
      }
    },
    border: {
      base: "#b8b8b8"
    },
    scrollbar: {
      base: "#a0a0a0"
    },
    diff: {
      text: {
        added: "#1e725c",
        context: "#7086b5",
        hunkHeader: "#7086b5"
      },
      background: {
        added: "#d5e5d5",
        removed: "#f7d8db"
      },
      highlight: {
        added: "#4db380",
        removed: "#f52a65"
      },
      lineNumber: {
        text: "#595959",
        background: {
          added: "#c5d5c5",
          removed: "#e7c8cb"
        }
      }
    },
    syntax: {
      number: "$hue.accent.200",
      type: "#b0851f"
    },
    markdown: {
      blockQuote: "#b0851f",
      emphasis: "#b0851f",
      strong: "$hue.accent.200"
    }
  },
  dark: {
    hue: {
      gray: {
        "100": "#ffffff",
        "200": "#eeeeee",
        "300": "#b5b5b5",
        "400": "#808080",
        "500": "#4c4c4c",
        "600": "#1e1e1e",
        "700": "#141414",
        "800": "#0a0a0a",
        "900": "#030303"
      },
      red: {
        "100": "#fd7e87",
        "200": "#e06c75",
        "300": "#c35a63",
        "400": "#a74952",
        "500": "#8c3941",
        "600": "#722931",
        "700": "#591921",
        "800": "#410a13",
        "900": "#280207"
      },
      orange: {
        "100": "#fddac5",
        "200": "#fab283",
        "300": "#d8976c",
        "400": "#b67c56",
        "500": "#966341",
        "600": "#774a2c",
        "700": "#593319",
        "800": "#3d1d06",
        "900": "#1f0b01"
      },
      green: {
        "100": "#96f7a7",
        "200": "#7fd88f",
        "300": "#68b977",
        "400": "#539c61",
        "500": "#3d7f4b",
        "600": "#296336",
        "700": "#144922",
        "800": "#00300f",
        "900": "#011705"
      },
      cyan: {
        "100": "#68d0dd",
        "200": "#56b6c2",
        "300": "#449da7",
        "400": "#33848e",
        "500": "#226c75",
        "600": "#0f555d",
        "700": "#093e44",
        "800": "#02292e",
        "900": "#001518"
      },
      blue: {
        "100": "#82b4fb",
        "200": "#5c9cf5",
        "300": "#4c86d6",
        "400": "#3c70b8",
        "500": "#2c5b9b",
        "600": "#1d477f",
        "700": "#0f3364",
        "800": "#02214a",
        "900": "#01112b"
      },
      purple: {
        "100": "#b38ff4",
        "200": "#9d7cd8",
        "300": "#8869bd",
        "400": "#7357a2",
        "500": "#5f4688",
        "600": "#4b356f",
        "700": "#392557",
        "800": "#271640",
        "900": "#17072b"
      },
      accent: "$hue.purple",
      interactive: "$hue.orange",
      neutral: "$hue.gray"
    }
  }
};
// ../tui-base/src/theme/assets/v2/opencode2.json
var opencode2_default = {
  $schema: "https://opencode.ai/theme.json",
  base: {
    categorical: [
      "blue",
      "purple",
      "green",
      "orange",
      "red"
    ],
    text: {
      base: "$hue.neutral.100",
      muted: "$hue.neutral.300",
      action: {
        primary: {
          base: "$text.base",
          $disabled: "$text.muted",
          $focused: "$text.base",
          $selected: "$hue.interactive.400"
        },
        secondary: {
          base: "$text.muted",
          $hovered: "$text.base",
          $focused: "$hue.interactive.200"
        },
        destructive: {
          base: "$hue.neutral.900",
          $disabled: "$text.muted"
        }
      },
      formfield: {
        base: "$text.base",
        $hovered: "$hue.interactive.400",
        $focused: "$hue.interactive.400",
        $pressed: "$hue.interactive.400",
        $disabled: "$text.muted",
        $selected: "$hue.interactive.400"
      },
      feedback: {
        error: {
          base: "$hue.red.400"
        },
        warning: {
          base: "#f5a742"
        },
        success: {
          base: "$hue.green.400"
        },
        info: {
          base: "$hue.blue.400"
        }
      }
    },
    background: {
      base: "$hue.neutral.900",
      raised: {
        base: "$hue.neutral.700",
        high: "$hue.neutral.600",
        max: "$hue.neutral.500"
      },
      action: {
        primary: {
          base: "transparent",
          $hovered: "$hue.neutral.700",
          $focused: "$hue.interactive.600",
          $selected: "transparent"
        },
        secondary: {
          base: "transparent"
        },
        destructive: {
          base: "$hue.red.400"
        }
      },
      formfield: {
        base: "$background.base"
      },
      feedback: {
        error: {
          base: "$background.base"
        },
        warning: {
          base: "$background.base"
        },
        success: {
          base: "$background.base"
        },
        info: {
          base: "$background.base"
        }
      }
    },
    border: {
      base: "#484848"
    },
    scrollbar: {
      base: "#606060"
    },
    diff: {
      text: {
        added: "#4fd6be",
        removed: "#c53b53",
        context: "#828bb8",
        hunkHeader: "#828bb8"
      },
      background: {
        added: "#20303b",
        removed: "#37222c",
        context: "$hue.neutral.700"
      },
      highlight: {
        added: "#b8db87",
        removed: "#e26a75"
      },
      lineNumber: {
        text: "#8f8f8f",
        background: {
          added: "#1b2b34",
          removed: "#2d1f26"
        }
      }
    },
    syntax: {
      comment: "#808080",
      keyword: "#9d7cd8",
      function: "#fab283",
      variable: "#e06c75",
      string: "#7fd88f",
      number: "#f5a742",
      type: "#e5c07b",
      operator: "#56b6c2",
      punctuation: "#eeeeee"
    },
    markdown: {
      text: "#eeeeee",
      heading: "#9d7cd8",
      link: "#fab283",
      linkText: "#56b6c2",
      code: "#7fd88f",
      blockQuote: "#e5c07b",
      emphasis: "#e5c07b",
      strong: "#f5a742",
      horizontalRule: "#808080",
      listItem: "#fab283",
      listEnumeration: "#56b6c2",
      image: "#fab283",
      imageText: "#56b6c2",
      codeBlock: "#eeeeee"
    },
    "@dialog": {
      background: {
        base: "$background.raised.base",
        action: {
          primary: {
            $hovered: "$background.raised.max"
          },
          secondary: {
            $hovered: "$background.raised.max"
          }
        }
      },
      "@footer": {
        text: {
          muted: "$hue.neutral.200"
        }
      }
    }
  },
  light: {
    hue: {
      gray: {
        "100": "#101010",
        "200": "#505050",
        "300": "#808080",
        "400": "#b5b5b5",
        "500": "#cfcfcf",
        "600": "#dddddd",
        "700": "#f2f2f2",
        "800": "#fafafa",
        "900": "#ffffff"
      },
      blue: {
        "100": "#1b1f2e",
        "200": "#6e7380",
        "300": "#9ba1b2",
        "400": "#6c8ffe",
        "500": "#b9c9f5",
        "600": "#d3ddf8",
        "700": "#eaf0ff",
        "800": "#f4f7ff",
        "900": "#fbfcff"
      },
      orange: {
        "100": "#2e241b",
        "200": "#7d7670",
        "300": "#afa49d",
        "400": "#c4713a",
        "500": "#e8c7ad",
        "600": "#f0dcce",
        "700": "#fcf2ea",
        "800": "#fdf8f4",
        "900": "#fefdfb"
      },
      purple: {
        "100": "#231b2e",
        "200": "#74707c",
        "300": "#a29dae",
        "400": "#9d78df",
        "500": "#cdbee7",
        "600": "#e8e0f8",
        "700": "#f0ebfa",
        "800": "#f8f5fc",
        "900": "#fcfbfe"
      },
      red: {
        "100": "#2e1b1b",
        "200": "#7e6d6d",
        "300": "#b09999",
        "400": "#ec6262",
        "500": "#eab8b8",
        "600": "#fbdada",
        "700": "#fdeaea",
        "800": "#fff6f6",
        "900": "#fffbfb"
      },
      green: {
        "100": "#1b2e1b",
        "200": "#6d7e6d",
        "300": "#99b099",
        "400": "#62ec62",
        "500": "#b8eab8",
        "600": "#dafbda",
        "700": "#eafdea",
        "800": "#f6fff6",
        "900": "#fbfffb"
      },
      accent: "$hue.blue",
      interactive: "$hue.blue",
      neutral: "$hue.gray"
    },
    text: {
      feedback: {
        warning: {
          base: "#d68c27"
        }
      }
    },
    border: {
      base: "#b8b8b8"
    },
    scrollbar: {
      base: "#a0a0a0"
    },
    diff: {
      text: {
        added: "#1e725c",
        removed: "#c53b53",
        context: "#7086b5",
        hunkHeader: "#7086b5"
      },
      background: {
        added: "#d5e5d5",
        removed: "#f7d8db",
        context: "$hue.neutral.700"
      },
      highlight: {
        added: "#4db380",
        removed: "#f52a65"
      },
      lineNumber: {
        text: "#595959",
        background: {
          added: "#c5d5c5",
          removed: "#e7c8cb"
        }
      }
    },
    syntax: {
      comment: "#8a8a8a",
      keyword: "#d68c27",
      function: "#3b7dd8",
      variable: "#d1383d",
      string: "#3d9a57",
      number: "#d68c27",
      type: "#b0851f",
      operator: "#318795",
      punctuation: "#1a1a1a"
    },
    markdown: {
      text: "#1a1a1a",
      heading: "#d68c27",
      link: "#3b7dd8",
      linkText: "#318795",
      code: "#3d9a57",
      blockQuote: "#b0851f",
      emphasis: "#b0851f",
      strong: "#d68c27",
      horizontalRule: "#8a8a8a",
      listItem: "#3b7dd8",
      listEnumeration: "#318795",
      image: "#3b7dd8",
      imageText: "#318795",
      codeBlock: "#1a1a1a"
    },
    "@dialog": {
      background: {
        base: "$hue.neutral.800",
        raised: {
          high: "$hue.neutral.700"
        },
        action: {
          primary: {
            $hovered: "$hue.neutral.600"
          },
          secondary: {
            $hovered: "$hue.neutral.600"
          }
        }
      }
    }
  },
  dark: {
    hue: {
      gray: {
        "100": "#ffffff",
        "200": "#b0b0b0",
        "300": "#808080",
        "400": "#444444",
        "500": "#303030",
        "600": "#202020",
        "700": "#141414",
        "800": "#101010",
        "900": "#080808"
      },
      blue: {
        "100": "#f1f4ff",
        "200": "#93a2b7",
        "300": "#6d7a8d",
        "400": "#7699fe",
        "500": "#426097",
        "600": "#23344b",
        "700": "#162333",
        "800": "#0d1621",
        "900": "#050a12"
      },
      orange: {
        "100": "#f6f0eb",
        "200": "#b09c8d",
        "300": "#807770",
        "400": "#ecb081",
        "500": "#896b50",
        "600": "#42372c",
        "700": "#2c241d",
        "800": "#1b1612",
        "900": "#0d0907"
      },
      purple: {
        "100": "#f7f2ff",
        "200": "#af9eba",
        "300": "#7d7492",
        "400": "#a383e2",
        "500": "#685588",
        "600": "#3b3347",
        "700": "#241e2c",
        "800": "#130f18",
        "900": "#0c080e"
      },
      red: {
        "100": "#fff2f2",
        "200": "#b09492",
        "300": "#90706f",
        "400": "#ef6c6c",
        "500": "#90494a",
        "600": "#4a2e2e",
        "700": "#2e1f1f",
        "800": "#1a1313",
        "900": "#0d0909"
      },
      green: {
        "100": "#f1f1f1",
        "200": "#c5cfc5",
        "300": "#8f9c8f",
        "400": "#9ee77a",
        "500": "#499049",
        "600": "#2c422c",
        "700": "#1f2e1f",
        "800": "#131a13",
        "900": "#090d09"
      },
      accent: "$hue.blue",
      interactive: "$hue.blue",
      neutral: "$hue.gray"
    }
  }
};

// ../tui-base/src/theme/index.ts
var customThemes = {};
var systemTheme;
var listeners = new Set;
var parsed = { current: new WeakMap, newDesigns: new WeakMap };
var opencodeTheme;
function getOpenCodeTheme() {
  if (opencodeTheme)
    return opencodeTheme;
  const document = parseThemeDocument(opencode_default, "opencode");
  opencodeTheme = document;
  return document;
}
var opencode2Theme;
function getOpenCode2Theme() {
  opencode2Theme ??= parseThemeDocument(opencode2_default, "opencode2");
  return opencode2Theme;
}
function listThemes() {
  const themes = {
    ...DEFAULT_THEMES,
    opencode: getOpenCodeTheme(),
    ...customThemes
  };
  return {
    ...themes,
    system: systemTheme ?? themes.system ?? themes.opencode
  };
}
function syncThemes() {
  const themes = listThemes();
  for (const listener of listeners)
    listener(themes);
}
function allThemes() {
  return listThemes();
}
function isThemeSource(source) {
  if (typeof source !== "object" || source === null || Array.isArray(source))
    return false;
  return "theme" in source || "base" in source;
}
function parseTheme(source, name = "theme", options = {}) {
  const cache = options.newDesigns ? parsed.newDesigns : parsed.current;
  const cached = cache.get(source);
  if (cached)
    return cached;
  const migrate = options.newDesigns ? migrateV1NewDesigns : migrateV1;
  const document = "theme" in source ? migrate(source) : parseThemeDocument(source, name);
  cache.set(source, document);
  return document;
}
function subscribeThemes(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function setCustomThemes(themes) {
  customThemes = Object.fromEntries(Object.entries(themes).filter((entry) => isThemeSource(entry[1])));
  syncThemes();
}
function setSystemTheme(theme) {
  systemTheme = theme;
  syncThemes();
}

// ../tui-base/src/theme/system.ts
import { RGBA as RGBA6 } from "@opentui/core";
function terminalMode(colors) {
  const bg = colors.defaultBackground;
  if (!bg)
    return;
  const { r, g, b } = RGBA6.fromHex(bg);
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.5 ? "light" : "dark";
}
function generateSystem(colors, mode) {
  const bg = RGBA6.fromHex(colors.defaultBackground ?? colors.palette[0]);
  const fg = RGBA6.fromHex(colors.defaultForeground ?? colors.palette[7]);
  const transparent = RGBA6.fromValues(bg.r, bg.g, bg.b, 0);
  const isDark = mode === "dark";
  const col = (index) => {
    const value = colors.palette[index];
    if (value)
      return RGBA6.fromHex(value);
    return ansiToRgba(index);
  };
  const grays = generateGrayScale(bg, isDark);
  const textMuted = generateMutedTextColor(bg, isDark);
  const ansiColors = {
    red: col(1),
    green: col(2),
    yellow: col(3),
    blue: col(4),
    magenta: col(5),
    cyan: col(6),
    redBright: col(9),
    greenBright: col(10)
  };
  const diffAlpha = isDark ? 0.22 : 0.14;
  const diffAddedBg = tint(bg, ansiColors.green, diffAlpha);
  const diffRemovedBg = tint(bg, ansiColors.red, diffAlpha);
  const diffContextBg = grays[2];
  const diffAddedLineNumberBg = tint(diffContextBg, ansiColors.green, diffAlpha);
  const diffRemovedLineNumberBg = tint(diffContextBg, ansiColors.red, diffAlpha);
  return {
    theme: {
      primary: ansiColors.cyan,
      secondary: ansiColors.magenta,
      accent: ansiColors.cyan,
      error: ansiColors.red,
      warning: ansiColors.yellow,
      success: ansiColors.green,
      info: ansiColors.cyan,
      text: fg,
      textMuted,
      selectedListItemText: bg,
      background: transparent,
      backgroundPanel: grays[2],
      backgroundElement: grays[3],
      backgroundMenu: grays[3],
      borderSubtle: grays[6],
      border: grays[7],
      borderActive: grays[8],
      diffAdded: ansiColors.green,
      diffRemoved: ansiColors.red,
      diffContext: grays[7],
      diffHunkHeader: grays[7],
      diffHighlightAdded: ansiColors.greenBright,
      diffHighlightRemoved: ansiColors.redBright,
      diffAddedBg,
      diffRemovedBg,
      diffContextBg,
      diffLineNumber: textMuted,
      diffAddedLineNumberBg,
      diffRemovedLineNumberBg,
      markdownText: fg,
      markdownHeading: fg,
      markdownLink: ansiColors.blue,
      markdownLinkText: ansiColors.cyan,
      markdownCode: ansiColors.green,
      markdownBlockQuote: ansiColors.yellow,
      markdownEmph: ansiColors.yellow,
      markdownStrong: fg,
      markdownHorizontalRule: grays[7],
      markdownListItem: ansiColors.blue,
      markdownListEnumeration: ansiColors.cyan,
      markdownImage: ansiColors.blue,
      markdownImageText: ansiColors.cyan,
      markdownCodeBlock: fg,
      syntaxComment: textMuted,
      syntaxKeyword: ansiColors.magenta,
      syntaxFunction: ansiColors.blue,
      syntaxVariable: fg,
      syntaxString: ansiColors.green,
      syntaxNumber: ansiColors.yellow,
      syntaxType: ansiColors.cyan,
      syntaxOperator: ansiColors.cyan,
      syntaxPunctuation: fg
    }
  };
}
function generateGrayScale(bg, isDark) {
  const grays = {};
  const bgR = bg.r * 255;
  const bgG = bg.g * 255;
  const bgB = bg.b * 255;
  const luminance = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;
  for (let i = 1;i <= 12; i++) {
    const factor = i / 12;
    if (isDark && luminance < 10) {
      const gray = Math.floor(factor * 0.4 * 255);
      grays[i] = RGBA6.fromInts(gray, gray, gray);
      continue;
    }
    if (!isDark && luminance > 245) {
      const gray = Math.floor(255 - factor * 0.4 * 255);
      grays[i] = RGBA6.fromInts(gray, gray, gray);
      continue;
    }
    const next = isDark ? luminance + (255 - luminance) * factor * 0.4 : luminance * (1 - factor * 0.4);
    const ratio = next / luminance;
    grays[i] = RGBA6.fromInts(Math.floor(Math.min(Math.max(bgR * ratio, 0), 255)), Math.floor(Math.min(Math.max(bgG * ratio, 0), 255)), Math.floor(Math.min(Math.max(bgB * ratio, 0), 255)));
  }
  return grays;
}
function generateMutedTextColor(bg, isDark) {
  const luminance = 0.299 * bg.r * 255 + 0.587 * bg.g * 255 + 0.114 * bg.b * 255;
  if (isDark) {
    const gray = luminance < 10 ? 180 : Math.min(Math.floor(160 + luminance * 0.3), 200);
    return RGBA6.fromInts(gray, gray, gray);
  }
  const gray = luminance > 245 ? 75 : Math.max(Math.floor(100 - (255 - luminance) * 0.2), 60);
  return RGBA6.fromInts(gray, gray, gray);
}

// ../tui-base/src/theme/component.ts
function createComponentTheme(view, surfaces = new Map) {
  return {
    get hue() {
      return view().hue;
    },
    get categorical() {
      return view().categorical;
    },
    get text() {
      return view().text;
    },
    get background() {
      return view().background;
    },
    get border() {
      return view().border;
    },
    get scrollbar() {
      return view().scrollbar;
    },
    get diff() {
      return view().diff;
    },
    get syntax() {
      return view().syntax;
    },
    get markdown() {
      return view().markdown;
    },
    source: (color) => view().source(color),
    increase: (color, amount = 1) => view().increase(color, amount),
    decrease: (color, amount = 1) => view().decrease(color, amount),
    surface(name) {
      const cached = surfaces.get(name);
      if (cached)
        return cached;
      const created = createComponentTheme(() => view().surface(name), surfaces);
      surfaces.set(name, created);
      return created;
    }
  };
}

// ../tui-base/src/context/theme.tsx
import { createEffect, createMemo as createMemo2, createSignal as createSignal3, onCleanup as onCleanup3, onMount, useContext as useContext5 } from "solid-js";
import { createStore as createStore3, produce as produce2 } from "solid-js/store";

// ../tui-base/src/context/helper.tsx
import { createComponent as _$createComponent } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { createContext, Show, useContext } from "solid-js";
function createSimpleContext(input) {
  const ctx = createContext();
  return {
    context: ctx,
    provider: (props) => {
      const init = input.init(props);
      return _$createComponent(Show, {
        get when() {
          return init.ready === undefined || init.ready === true;
        },
        get children() {
          return _$createComponent(ctx.Provider, {
            value: init,
            get children() {
              return props.children;
            }
          });
        }
      });
    },
    use() {
      const value = useContext(ctx);
      if (!value)
        throw new Error(`${input.name} context must be used within a context provider`);
      return value;
    }
  };
}

// ../tui-base/src/config/index.tsx
import { createComponent as _$createComponent2 } from "@opentui/solid";
import { createBindingLookup } from "@opentui/keymap/extras";
// ../tui-base/src/vendor/schema/src/schema.ts
var PositiveInt = Int.check(isGreaterThan3(0));
var NonNegativeInt = Int.check(isGreaterThanOrEqualTo3(0));
var RelativePath = String4.pipe(brand("RelativePath"), annotate2({ identifier: "RelativePath" }));
var AbsolutePath = String4.pipe(brand("AbsolutePath"), annotate2({ identifier: "AbsolutePath" }));
var optional3 = (schema) => optionalKey2(schema).pipe(decodeTo2(optional2(toType2(schema)), {
  decode: passthrough({ strict: false }),
  encode: transformOptional(filter((value) => value !== undefined))
}));
var DateTimeUtcFromMillis = Finite.pipe(decodeTo2(DateTimeUtc, {
  decode: transform((value) => makeUnsafe3(value)),
  encode: transform((value) => toEpochMillis2(value))
}));

// ../tui-base/src/vendor/schema/src/vcs.ts
var Branch = Struct({
  current: optional3(String4),
  default: optional3(String4)
}).annotate({ identifier: "Vcs.Branch" });
var Info = Struct({
  provider: optional3(String4),
  branch: Branch
}).annotate({ identifier: "Vcs.Info" });
var BranchList = ArraySchema(String4).annotate({ identifier: "Vcs.BranchList" });
var Base = Struct({
  name: String4,
  ref: String4,
  source: Literals(["reflog", "default"])
}).annotate({ identifier: "Vcs.Base" });
var Mode2 = Literals(["working", "branch", "committed"]).annotate({ identifier: "Vcs.Mode" });
var Untracked = Literals(["files", "folders"]).annotate({ identifier: "Vcs.Untracked" });
var FileStatus = Struct({
  file: String4,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  status: Literals(["added", "deleted", "modified"])
}).annotate({ identifier: "Vcs.FileStatus" });

// ../tui-base/src/config/index.tsx
import { createContext as createContext2, createMemo, onCleanup, useContext as useContext2 } from "solid-js";
import { createStore, reconcile } from "solid-js/store";

// ../tui-base/src/util/watch.ts
import { watch } from "node:fs";
function safeWatch(target, listener) {
  const disabled = process.env.OPENCODE_FILEWATCHER_DISABLE ?? process.env.OPENCODE_DISABLE_FILEWATCHER;
  if (disabled === "1" || disabled?.toLowerCase() === "true")
    return;
  try {
    const watcher = watch(target, listener);
    watcher.on("error", (error) => {
      watcher.close();
      console.error("Watch failed, live-reload disabled", { target, error });
    });
    return watcher;
  } catch (error) {
    console.error("Failed to watch path, live-reload disabled", { target, error });
    return;
  }
}

// ../tui-base/src/config/index.tsx
import path from "path";
var AttentionSoundName = Literals(["default", "question", "permission", "error", "done", "subagent_done"]);
var MiniWorkSpinner = Literals(["block-soft-slide", "block-soft-sweep", "block-low-comet", "block-low-duet", "block-shuttle", "block-bridge", "block-squeeze", "small-toggle", "square-toggle", "grow-shrink", "quadrant-orbit", "crosshatch", "density-wave", "seed"]);
var Plugin = Union2([String4, Struct({
  package: String4.annotate({
    description: "Plugin package name or path"
  }),
  options: optional2(Record(String4, Any2)).annotate({
    description: "Options passed to the plugin"
  })
})]);
var DiffSource = Union2([Mode2, Literal2("turn")]);
var Cursor = Struct({
  style: optional2(Literals(["block", "underline", "line", "default"])).annotate({
    description: "Cursor shape. Use 'default' to preserve the terminal setting"
  }),
  blinking: optional2(Boolean3).annotate({
    description: "Whether the cursor blinks. Has no effect when style is 'default'"
  })
}).annotate({
  description: "Terminal cursor settings"
});
var Info2 = Struct({
  theme: optional2(Struct({
    name: optional2(String4).annotate({
      description: "Theme name"
    }),
    mode: optional2(Literals(["system", "dark", "light"])).annotate({
      description: "Color mode; 'system' follows the terminal"
    })
  })).annotate({
    description: "Color theme settings"
  }),
  keybinds: optional2(KeybindOverrides).annotate({
    description: "Custom key bindings"
  }),
  plugins: optional2(ArraySchema(Plugin)).annotate({
    description: "Ordered plugin enablement directives and external package declarations"
  }),
  leader: optional2(Struct({
    timeout: optional2(Int.check(isGreaterThan3(0))).annotate({
      description: "Time in milliseconds to wait for a key after the leader key"
    })
  })).annotate({
    description: "Leader key behavior"
  }),
  scroll: optional2(Struct({
    speed: optional2(Finite.check(isGreaterThanOrEqualTo3(0.001))).annotate({
      description: "Distance scrolled per input tick"
    }),
    acceleration: optional2(Boolean3).annotate({
      description: "Accelerate scrolling from repeated input"
    })
  })).annotate({
    description: "Scrolling behavior"
  }),
  attention: optional2(Struct({
    notifications: optional2(Boolean3).annotate({
      description: "Show system notifications"
    }),
    sound: optional2(Boolean3).annotate({
      description: "Play attention sounds"
    }),
    volume: optional2(Finite.check(isGreaterThanOrEqualTo3(0), isLessThanOrEqualTo3(1))).annotate({
      description: "Attention sound volume from 0 to 1"
    }),
    sound_pack: optional2(String4).annotate({
      description: "Active attention sound pack ID"
    }),
    sounds: optional2(Record(AttentionSoundName, optionalKey2(String4))).annotate({
      description: "Sound file overrides by attention event"
    })
  })).annotate({
    description: "System notification and sound settings"
  }),
  diffs: optional2(Struct({
    source: optional2(DiffSource).annotate({
      description: "Initial diff source; defaults to 'branch' (branch and uncommitted changes). 'turn' shows the session's last turn and falls back to 'branch' outside a session"
    }),
    wrap: optional2(Literals(["word", "none"])).annotate({
      description: "Line wrapping behavior in diff output"
    }),
    tree: optional2(Boolean3).annotate({
      description: "Show the diff file tree"
    }),
    single: optional2(Boolean3).annotate({
      description: "Show only the selected file patch"
    }),
    fullscreen: optional2(Boolean3).annotate({
      description: "Open the diff side panel full screen; remembers the last full screen toggle"
    }),
    view: optional2(Literals(["auto", "split", "unified"])).annotate({
      description: "Diff layout; 'auto' selects a layout from the available width"
    })
  })).annotate({
    description: "Diff presentation settings"
  }),
  terminal: optional2(Struct({
    title: optional2(Boolean3).annotate({
      description: "Update the terminal window title"
    }),
    copy: optional2(Literals(["manual", "select"])).annotate({
      description: "Copy text manually or immediately after selecting it"
    })
  })).annotate({
    description: "Terminal integration settings"
  }),
  prompt: optional2(Struct({
    editor: optional2(Boolean3).annotate({
      description: "Include the active editor file or selection as prompt context"
    }),
    paste: optional2(Literals(["compact", "full"])).annotate({
      description: "Display large pastes as compact placeholders or full text"
    }),
    image_preview: optional2(Boolean3).annotate({
      description: "Show image attachment previews above the prompt input"
    })
  })).annotate({
    description: "Prompt input behavior"
  }),
  session: optional2(Struct({
    sidebar: optional2(Literals(["auto", "hide"])).annotate({
      description: "Session sidebar visibility; 'auto' shows it when space permits"
    }),
    scrollbar: optional2(Boolean3).annotate({
      description: "Show the session transcript scrollbar"
    }),
    submit_scroll: optional2(Literals(["bottom", "keep"])).annotate({
      description: "Jump to the latest message when sending a prompt, or keep the current transcript position"
    }),
    thinking: optional2(Literals(["show", "hide"])).annotate({
      description: "Show or hide model reasoning by default"
    }),
    grouping: optional2(Literals(["auto", "none"])).annotate({
      description: "Group related transcript items automatically or render each item separately"
    }),
    verbosity: optional2(Literals(["low", "medium", "high"])).annotate({
      description: "Transcript detail level: low summarizes each run of tools and thoughts, high opens exploration and instruction groups"
    }),
    image_preview: optional2(Boolean3).annotate({
      description: "Show user attachment and tool-result images in the session transcript"
    }),
    tps: optional2(Boolean3).annotate({
      description: "Show average tokens per second"
    }),
    markdown: optional2(Literals(["source", "rendered"])).annotate({
      description: "Show Markdown syntax markers or conceal them in rendered transcript content"
    }),
    new_location: optional2(Literals(["launch", "inherit"])).annotate({
      description: "Start new sessions in the TUI launch directory or inherit the active session location"
    }),
    permissions: optional2(Literals(["prompt", "autoaccept"])).annotate({
      description: "Prompt for permission requests or accept them automatically"
    })
  })).annotate({
    description: "Session transcript presentation settings"
  }),
  tabs: optional2(Struct({
    mode: optional2(Literals(["auto", "on", "off"])).annotate({
      description: "Use session tabs always, never, or when the terminal environment supports them"
    }),
    enabled: optional2(Boolean3).annotate({
      description: "Legacy tab toggle; use mode instead"
    }),
    scope: optional2(Literals(["global", "cwd"])).annotate({
      description: "Share tabs globally or keep a separate set for each working directory"
    }),
    layout: optional2(Literals(["horizontal", "vertical"])).annotate({
      description: "Show tabs in a horizontal strip or vertical sidebar"
    }),
    indicators: optional2(Literals(["status", "numbers"])).annotate({
      description: "Show status icons or always show tab numbers"
    })
  })).annotate({
    description: "Tab strip settings"
  }),
  mini: optional2(Struct({
    thinking: optional2(Literals(["show", "hide"])).annotate({
      description: "Show or hide model reasoning"
    }),
    tools: optional2(Literals(["show", "hide"])).annotate({
      description: "Show or hide tool calls and the assistant text that precedes them"
    }),
    shell_output: optional2(Literals(["show", "hide"])).annotate({
      description: "Show or hide raw shell tool output"
    }),
    turn_summary: optional2(Literals(["show", "hide"])).annotate({
      description: "Show or hide the agent, model, and duration summary in scrollback"
    }),
    footer: optional2(Literals(["show", "hide"])).annotate({
      description: "Show or hide persistent activity, model, usage, and context details in the footer"
    }),
    splash: optional2(Literals(["show", "hide"])).annotate({
      description: "Show or hide the entry and exit splash banners"
    }),
    work_spinner: optional2(MiniWorkSpinner).annotate({
      description: "Work spinner animation in the Mini footer (default: block-soft-slide)"
    }),
    mono: optional2(Boolean3).annotate({
      description: "Use monochrome ASCII output"
    }),
    replay: optional2(Boolean3).annotate({
      description: "Restore session history on resume and terminal resize"
    }),
    replay_limit: optional2(Int.check(isGreaterThan3(0))).annotate({
      description: "Maximum number of newest messages restored during replay"
    })
  })).annotate({
    description: "Mini transcript presentation settings"
  }),
  debug: optional2(Struct({
    devtools: optional2(Boolean3).annotate({
      description: "Show the DevTools debug bar"
    }),
    timing: optional2(Boolean3).annotate({
      description: "Show time-to-first-draw diagnostics"
    }),
    turn_tokens: optional2(Union2([Boolean3, Literal2("verbose")])).annotate({
      description: "Show per-turn token usage diagnostics, optionally with tool call inputs"
    })
  })).annotate({
    description: "Debugging settings"
  }),
  experimental: optional2(Record(String4, Boolean3)).annotate({
    description: "Experimental features that may change or be removed at any time"
  }),
  animations: optional2(Boolean3).annotate({
    description: "Enable interface animations"
  }),
  highlights: optional2(Boolean3).annotate({
    description: "Show the release highlights once after OpenCode updates"
  }),
  mouse: optional2(Boolean3).annotate({
    description: "Enable terminal mouse capture"
  }),
  cursor: optional2(Cursor)
});
function resolve3(input, options) {
  const tabsMode = input.tabs?.mode ?? (input.tabs?.enabled === undefined ? "auto" : input.tabs.enabled ? "on" : "off");
  const keybinds = {
    ...input.keybinds
  };
  if (!options.terminalSuspend) {
    keybinds["terminal.suspend"] = "none";
    if (keybinds["input.undo"] === undefined) {
      const inputUndo = defaultValue("input.undo");
      keybinds["input.undo"] = ["ctrl+z", ...typeof inputUndo === "string" ? inputUndo.split(",") : []].filter((value, index, values) => values.indexOf(value) === index).join(",");
    }
  }
  return {
    ...input,
    attention: {
      notifications: input.attention?.notifications ?? false,
      sound: input.attention?.sound ?? false,
      volume: input.attention?.volume ?? 0.4,
      sound_pack: input.attention?.sound_pack ?? "opencode.default",
      sounds: input.attention?.sounds ?? {}
    },
    keybinds: createBindingLookup(toBindingConfig(parse(keybinds)), {
      bindingDefaults: bindingDefaults()
    }),
    leader: {
      timeout: input.leader?.timeout ?? 2000
    },
    mouse: input.mouse ?? true,
    cursor: {
      style: input.cursor?.style ?? "block",
      blinking: input.cursor?.blinking ?? true
    },
    session: {
      ...input.session,
      new_location: input.session?.new_location ?? "launch",
      permissions: input.session?.permissions ?? "prompt",
      tps: input.session?.tps ?? true
    },
    tabs: {
      ...input.tabs,
      mode: tabsMode,
      enabled: tabsMode === "on" || tabsMode === "auto" && (options.environment ?? process.env).HERDR_ENV !== "1",
      scope: input.tabs?.scope ?? "cwd",
      layout: input.tabs?.layout ?? "horizontal",
      indicators: input.tabs?.indicators ?? "status"
    }
  };
}
var ConfigContext = createContext2();
function ConfigProvider(props) {
  const [config, setConfig] = createStore(props.config);
  const host = props.service;
  const apply = (info) => setConfig(reconcile(resolve3(info, props.options ?? {
    terminalSuspend: true
  })));
  const update = async (update) => {
    if (!host)
      throw new Error("Config updates are not available");
    const info = await host.update(update);
    apply(info);
    return info;
  };
  let reload = Promise.resolve();
  const watcher = host?.path ? safeWatch(path.dirname(host.path), () => {
    reload = reload.then(() => host.get()).then(apply).catch(() => {});
  }) : undefined;
  onCleanup(() => watcher?.close());
  return _$createComponent2(ConfigContext.Provider, {
    get value() {
      return {
        data: config,
        path: host?.path,
        update
      };
    },
    get children() {
      return props.children;
    }
  });
}
function useConfig() {
  const value = useContext2(ConfigContext);
  if (!value)
    throw new Error("ConfigProvider is missing");
  return value;
}
function useCursorStyle() {
  const config = useConfig();
  return createMemo(() => ({
    style: config.data.cursor.style,
    blinking: config.data.cursor.blinking
  }));
}
function useNewDesigns() {
  const config = useConfig();
  return () => config.data.experimental?.["new-designs"] === true;
}

// ../tui-base/src/context/storage.tsx
import { createComponent as _$createComponent3 } from "@opentui/solid";
import { batch, createContext as createContext4, onCleanup as onCleanup2, useContext as useContext4 } from "solid-js";
import { createStore as createStore2, produce, reconcile as reconcile2 } from "solid-js/store";

// ../tui-base/src/vendor/util/src/flock.ts
import path2 from "path";
import os from "os";
import { randomBytes, randomUUID as randomUUID2 } from "crypto";
import { mkdir, readFile, rm, stat, utimes, writeFile } from "fs/promises";

// ../tui-base/src/vendor/util/src/hash.ts
import { createHash } from "crypto";
var Hash;
((Hash) => {
  function fast(input) {
    return createHash("sha1").update(input).digest("hex");
  }
  Hash.fast = fast;
  function sha256(input) {
    return createHash("sha256").update(input).digest("hex");
  }
  Hash.sha256 = sha256;
})(Hash ||= {});

// ../tui-base/src/vendor/util/src/flock.ts
var Flock;
((Flock) => {
  let global;
  function setGlobal(g) {
    global = g;
  }
  Flock.setGlobal = setGlobal;
  const root = () => {
    if (!global)
      throw new Error("Flock global not set");
    return path2.join(global.state, "locks");
  };
  const defaultOpts = {
    staleMs: 60000,
    timeoutMs: 5 * 60000,
    baseDelayMs: 100,
    maxDelayMs: 2000
  };
  function code(err) {
    if (typeof err !== "object" || err === null || !("code" in err))
      return;
    const value = err.code;
    if (typeof value !== "string")
      return;
    return value;
  }
  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason ?? new Error("Aborted"));
        return;
      }
      let timer;
      const done = () => {
        signal?.removeEventListener("abort", abort);
        resolve();
      };
      const abort = () => {
        if (timer) {
          clearTimeout(timer);
        }
        signal?.removeEventListener("abort", abort);
        reject(signal?.reason ?? new Error("Aborted"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(done, ms);
    });
  }
  function jitter(ms) {
    const j = Math.floor(ms * 0.3);
    const d = Math.floor(Math.random() * (2 * j + 1)) - j;
    return Math.max(0, ms + d);
  }
  function mono() {
    return performance.now();
  }
  function wall() {
    return performance.timeOrigin + mono();
  }
  async function stats(file) {
    try {
      return await stat(file);
    } catch (err) {
      const errCode = code(err);
      if (errCode === "ENOENT" || errCode === "ENOTDIR")
        return;
      throw err;
    }
  }
  async function stale(lockDir, heartbeatPath, metaPath, staleMs) {
    const now = wall();
    const heartbeat = await stats(heartbeatPath);
    if (heartbeat) {
      return now - heartbeat.mtimeMs > staleMs;
    }
    const meta = await stats(metaPath);
    if (meta) {
      return now - meta.mtimeMs > staleMs;
    }
    const dir = await stats(lockDir);
    if (!dir) {
      return false;
    }
    return now - dir.mtimeMs > staleMs;
  }
  async function tryAcquireLockDir(lockDir, opts) {
    const token = randomUUID2?.() ?? randomBytes(16).toString("hex");
    const metaPath = path2.join(lockDir, "meta.json");
    const heartbeatPath = path2.join(lockDir, "heartbeat");
    try {
      await mkdir(lockDir, { mode: 448 });
    } catch (err) {
      if (code(err) !== "EEXIST") {
        throw err;
      }
      if (!await stale(lockDir, heartbeatPath, metaPath, opts.staleMs)) {
        return { acquired: false };
      }
      const breakerPath = lockDir + ".breaker";
      try {
        await mkdir(breakerPath, { mode: 448 });
      } catch (claimErr) {
        const errCode = code(claimErr);
        if (errCode === "EEXIST") {
          const breaker = await stats(breakerPath);
          if (breaker && wall() - breaker.mtimeMs > opts.staleMs) {
            await rm(breakerPath, { recursive: true, force: true }).catch(() => {
              return;
            });
          }
          return { acquired: false };
        }
        if (errCode === "ENOENT" || errCode === "ENOTDIR") {
          return { acquired: false };
        }
        throw claimErr;
      }
      try {
        if (!await stale(lockDir, heartbeatPath, metaPath, opts.staleMs)) {
          return { acquired: false };
        }
        await rm(lockDir, { recursive: true, force: true });
        try {
          await mkdir(lockDir, { mode: 448 });
        } catch (retryErr) {
          const errCode = code(retryErr);
          if (errCode === "EEXIST" || errCode === "ENOTEMPTY") {
            return { acquired: false };
          }
          throw retryErr;
        }
      } finally {
        await rm(breakerPath, { recursive: true, force: true }).catch(() => {
          return;
        });
      }
    }
    const meta = {
      token,
      pid: process.pid,
      hostname: os.hostname(),
      createdAt: new Date().toISOString()
    };
    await writeFile(heartbeatPath, "", { flag: "wx" }).catch(async () => {
      await rm(lockDir, { recursive: true, force: true });
      throw new Error("Lock acquired but heartbeat already existed (possible compromise).");
    });
    await writeFile(metaPath, JSON.stringify(meta, null, 2), { flag: "wx" }).catch(async () => {
      await rm(lockDir, { recursive: true, force: true });
      throw new Error("Lock acquired but meta.json already existed (possible compromise).");
    });
    let timer;
    const startHeartbeat = (intervalMs = Math.max(100, Math.floor(opts.staleMs / 3))) => {
      if (timer)
        return;
      timer = setInterval(() => {
        const t = new Date;
        utimes(heartbeatPath, t, t).catch(() => {
          return;
        });
      }, intervalMs);
      timer.unref?.();
    };
    const release = async () => {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      const current = await readFile(metaPath, "utf8").then((raw) => {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object")
          return {};
        return {
          token: "token" in parsed && typeof parsed.token === "string" ? parsed.token : undefined
        };
      }).catch((err) => {
        const errCode = code(err);
        if (errCode === "ENOENT" || errCode === "ENOTDIR") {
          throw new Error("Refusing to release: lock is compromised (metadata missing).");
        }
        if (err instanceof SyntaxError) {
          throw new Error("Refusing to release: lock is compromised (metadata invalid).");
        }
        throw err;
      });
      if (current.token !== token) {
        throw new Error("Refusing to release: lock token mismatch (not the owner).");
      }
      await rm(lockDir, { recursive: true, force: true });
    };
    return {
      acquired: true,
      startHeartbeat,
      release
    };
  }
  async function acquireLockDir(lockDir, input, opts) {
    const stop = mono() + opts.timeoutMs;
    let attempt = 0;
    let waited = 0;
    let delay = opts.baseDelayMs;
    while (true) {
      input.signal?.throwIfAborted();
      const res = await tryAcquireLockDir(lockDir, opts);
      if (res.acquired) {
        return res;
      }
      if (mono() > stop) {
        throw new Error(`Timed out waiting for lock: ${input.key}`);
      }
      attempt += 1;
      const ms = jitter(delay);
      await input.onWait?.({
        key: input.key,
        attempt,
        delay: ms,
        waited
      });
      await sleep(ms, input.signal);
      waited += ms;
      delay = Math.min(opts.maxDelayMs, Math.floor(delay * 1.7));
    }
  }
  async function acquire(key, input = {}) {
    input.signal?.throwIfAborted();
    const cfg = {
      staleMs: input.staleMs ?? defaultOpts.staleMs,
      timeoutMs: input.timeoutMs ?? defaultOpts.timeoutMs,
      baseDelayMs: input.baseDelayMs ?? defaultOpts.baseDelayMs,
      maxDelayMs: input.maxDelayMs ?? defaultOpts.maxDelayMs
    };
    const dir = input.dir ?? root();
    await mkdir(dir, { recursive: true });
    const lockfile = path2.join(dir, Hash.fast(key) + ".lock");
    const lock = await acquireLockDir(lockfile, {
      key,
      onWait: input.onWait,
      signal: input.signal
    }, cfg);
    lock.startHeartbeat();
    const release = () => lock.release();
    return {
      release,
      [Symbol.asyncDispose]() {
        return release();
      }
    };
  }
  Flock.acquire = acquire;
  async function withLock(key, fn, input = {}) {
    let __stack = [];
    try {
      const _ = __using(__stack, await acquire(key, input), 1);
      input.signal?.throwIfAborted();
      return await fn();
    } catch (_catch) {
      var _err = _catch, _hasErr = 1;
    } finally {
      var _promise = __callDispose(__stack, _err, _hasErr);
      _promise && await _promise;
    }
  }
  Flock.withLock = withLock;
})(Flock ||= {});

// ../tui-base/src/context/runtime.tsx
import { createComponent, createContext as createContext3, useContext as useContext3 } from "solid-js";
var PathsContext = createContext3();
var AppContext = createContext3();
var TerminalEnvironmentContext = createContext3();
var StartupContext = createContext3();
var LifecycleContext = createContext3();

// ../tui-base/src/context/storage.tsx
var Context2 = createContext4();
function useStorageOptional() {
  return useContext4(Context2);
}

// ../tui-base/src/devtools/index.ts
import { createSignal as createSignal2 } from "solid-js";
var [groups, setGroups] = createSignal2([]);
function register(input) {
  setGroups((groups) => {
    if (groups.some((group) => group.id === input.id)) {
      return groups.map((group) => group.id === input.id ? { ...group, title: input.title } : group);
    }
    return [...groups, { ...input, entries: [] }];
  });
  return {
    set(key, value) {
      setGroups((groups) => groups.map((group) => {
        if (group.id !== input.id)
          return group;
        if (group.entries.some((entry) => entry.key === key)) {
          return {
            ...group,
            entries: group.entries.map((entry) => entry.key === key ? { key, value } : entry)
          };
        }
        return { ...group, entries: [...group.entries, { key, value }] };
      }));
    }
  };
}

// ../tui-base/src/context/theme.tsx
var themePerformance = register({
  id: "theme-performance",
  title: "Theme performance"
});
function createThemeErrors() {
  let handler;
  let pending;
  return {
    emit(name, cause) {
      const event = {
        name,
        error: cause instanceof Error ? cause : new Error(String(cause))
      };
      if (handler) {
        handler(event);
        return;
      }
      pending = event;
    },
    onError(next) {
      handler = next;
      if (pending) {
        next(pending);
        pending = undefined;
      }
      return () => {
        if (handler === next)
          handler = undefined;
      };
    }
  };
}
var themeErrors = createThemeErrors();
var THEME_REFRESH_DELAYS = [250, 1000];
var [store, setStore] = createStore3({
  mode: "dark",
  lock: undefined,
  active: "opencode",
  ready: false
});
var [themeSources, setThemeSources] = createSignal3(allThemes());
subscribeThemes(setThemeSources);
var themeContext = createSimpleContext({
  name: "Theme",
  init: (props) => {
    const renderer = useRenderer();
    const configState = useConfig();
    const newDesigns = useNewDesigns();
    const config = configState.data;
    const themes = props.source;
    const cache = useStorageOptional()?.store("system-theme", {
      initial: {}
    });
    setStore(produce2((draft) => {
      const lock = config.theme?.mode === "dark" || config.theme?.mode === "light" ? config.theme.mode : undefined;
      const mode = lock ?? renderer.themeMode ?? props.mode;
      draft.mode = mode;
      draft.lock = lock;
      draft.active = config.theme?.name ?? "opencode";
      draft.ready = false;
    }));
    createEffect(() => {
      const theme = config.theme?.name;
      if (!theme)
        return;
      setStore("active", theme);
      if (theme === "system")
        refreshPalette();
    });
    createEffect(() => {
      const mode = config.theme?.mode;
      if (mode === "dark" || mode === "light") {
        pin(mode, false);
        return;
      }
      if (mode === "system" && store.lock !== undefined)
        free(false);
    });
    function syncCustomThemes() {
      return themes.discover().then((themes) => {
        setCustomThemes(themes);
      }).catch(() => setStore("active", "opencode"));
    }
    onMount(() => {
      syncCustomThemes().finally(() => {
        tokens();
        setStore("ready", true);
      });
    });
    const cachedPalette = cache?.[0].colors;
    let palette = usablePalette(cachedPalette) ? cachedPalette : undefined;
    const applyPalette = () => {
      if (palette)
        setSystemTheme(generateSystem(palette, store.mode));
    };
    if (palette) {
      const mode = store.lock ?? terminalMode(palette) ?? store.mode;
      if (store.mode !== mode)
        setStore("mode", mode);
      applyPalette();
    } else
      setSystemTheme(undefined);
    let canProbe = false;
    let probing = false;
    let queued = false;
    let disposed = false;
    function refreshPalette() {
      if (store.active !== "system")
        return;
      queued = true;
      if (!canProbe || probing || disposed)
        return;
      queued = false;
      probing = true;
      const retry = renderer.paletteDetectionStatus === "detecting";
      renderer.clearPaletteCache();
      renderer.getPalette({
        size: 16
      }).then((colors) => {
        if (disposed || !usablePalette(colors))
          return;
        palette = colors;
        const mode = store.lock ?? terminalMode(colors) ?? store.mode;
        if (store.mode !== mode)
          setStore("mode", mode);
        applyPalette();
        cache?.[1]((draft) => {
          draft.colors = colors;
        }).catch(() => {});
      }).catch(() => {}).finally(() => {
        probing = false;
        if (disposed || !retry && !queued)
          return;
        refreshPalette();
      });
    }
    function afterPaint() {
      canProbe = true;
      refreshPalette();
    }
    function apply(mode) {
      if (store.mode !== mode) {
        setStore("mode", mode);
        applyPalette();
      }
      refreshPalette();
    }
    function pin(mode = store.mode, persist = true) {
      setStore("lock", mode);
      apply(mode);
      if (!persist)
        return;
      configState.update((draft) => {
        draft.theme = {
          ...draft.theme,
          mode
        };
      }).catch(() => {});
    }
    function free(persist = true) {
      setStore("lock", undefined);
      apply(renderer.themeMode ?? store.mode);
      if (!persist)
        return;
      configState.update((draft) => {
        draft.theme = {
          ...draft.theme,
          mode: "system"
        };
      }).catch(() => {});
    }
    const handleMode = (mode) => {
      if (store.lock)
        return;
      apply(mode);
    };
    renderer.on(CliRenderEvents.THEME_MODE, handleMode);
    const handleThemeNotification = (sequence) => {
      if (sequence !== "\x1B[?997;1n" && sequence !== "\x1B[?997;2n")
        return false;
      queueMicrotask(refreshPalette);
      return false;
    };
    renderer.prependInputHandler(handleThemeNotification);
    let themeRefreshTimeouts = [];
    const refreshThemes = () => {
      for (const timeout of themeRefreshTimeouts)
        clearTimeout(timeout);
      themeRefreshTimeouts = THEME_REFRESH_DELAYS.map((delay) => setTimeout(() => {
        refreshPalette();
        if (delay === THEME_REFRESH_DELAYS[THEME_REFRESH_DELAYS.length - 1])
          syncCustomThemes();
      }, delay));
    };
    const unsubscribeRefresh = themes.subscribeRefresh?.(refreshThemes);
    onCleanup3(() => {
      disposed = true;
      renderer.off(CliRenderEvents.THEME_MODE, handleMode);
      renderer.removeInputHandler(handleThemeNotification);
      unsubscribeRefresh?.();
      for (const timeout of themeRefreshTimeouts)
        clearTimeout(timeout);
      themeRefreshTimeouts.length = 0;
    });
    const available = createMemo2(() => newDesigns() ? {
      opencode2: getOpenCode2Theme(),
      ...themeSources()
    } : themeSources());
    const has = (name) => Boolean(name) && available()[name] !== undefined;
    const initStarted = performance.now();
    const selected = createMemo2(() => {
      const sources = available();
      const name = sources[store.active] ? store.active : "opencode";
      try {
        return loadTheme(sources[name], name, store.mode, newDesigns());
      } catch (error) {
        if (name === "opencode")
          throw error;
        themeErrors.emit(name, error);
        setStore("active", "opencode");
        return loadTheme(sources.opencode, "opencode", store.mode, newDesigns());
      }
    });
    const modes = () => selected().modes;
    const mode = () => selected().mode;
    const tokens = () => selected().theme;
    tokens();
    themePerformance.set("Init", `${(performance.now() - initStarted).toFixed(2)} ms`);
    const current = createComponentTheme(tokens);
    createEffect(() => renderer.setBackgroundColor(tokens().background.base));
    const currentSyntax = createSyntaxStyleMemo(() => generateSyntax(tokens(), renderer.nativeScene));
    const service = {
      current,
      currentTokens: tokens,
      currentSyntax,
      get selected() {
        return store.active;
      },
      all: available,
      has,
      mode,
      modes,
      supports: (requested) => modes().includes(requested),
      locked: () => store.lock !== undefined,
      lock: () => pin(mode()),
      unlock: free,
      setMode(requested = mode(), persist = true) {
        if (!modes().includes(requested))
          return false;
        pin(requested, persist);
        return true;
      },
      set(theme) {
        if (!has(theme))
          return false;
        setStore("active", theme);
        if (theme === "system")
          refreshPalette();
        configState.update((draft) => {
          draft.theme = {
            ...draft.theme,
            name: theme
          };
        }).catch(() => {});
        return true;
      },
      afterPaint,
      onError: themeErrors.onError,
      get ready() {
        return store.ready;
      }
    };
    return {
      current,
      themes: service,
      get ready() {
        return service.ready;
      }
    };
  }
});
function useThemes() {
  return themeContext.use().themes;
}
function useTheme() {
  return themeContext.use().current;
}
function useThemeOptional() {
  return useContext5(themeContext.context)?.current;
}
function useThemesOptional() {
  return useContext5(themeContext.context)?.themes;
}
var ThemeProvider = themeContext.provider;
function ThemeContextProvider(props) {
  const value = themeContext.use();
  const current = createComponentTheme(() => {
    const name = props.context;
    return name ? value.themes.currentTokens().surface(name) : value.current;
  });
  return _$createComponent4(themeContext.context.Provider, {
    get value() {
      return {
        current,
        themes: value.themes,
        ready: value.ready
      };
    },
    get children() {
      return props.children;
    }
  });
}
function usablePalette(colors) {
  return Boolean(colors && (colors.defaultBackground ?? colors.palette[0]) && (colors.defaultForeground ?? colors.palette[7]));
}
function loadTheme(source, name, requested, newDesigns) {
  const document = parseTheme(source, name, {
    newDesigns
  });
  const modes = themeModes(document);
  const mode = modes.includes(requested) ? requested : modes[0] ?? requested;
  return {
    modes,
    mode,
    theme: resolveThemeDocument(document, mode)
  };
}
function createSyntaxStyleMemo(factory) {
  const renderer = useRenderer();
  const retained = new Set;
  let current;
  const release = (style) => {
    retained.add(style);
    renderer.idle().catch(() => {}).finally(() => {
      if (!retained.delete(style))
        return;
      style.destroy();
    });
  };
  onCleanup3(() => {
    if (current)
      release(current);
  });
  return createMemo2(() => {
    const previous = current;
    current = factory();
    if (previous)
      release(previous);
    return current;
  });
}

// ../tui-base/src/routes/session/session-composer.tsx
var FOOTER_HEIGHT = 1;
function SessionComposer(props) {
  const renderer = useRenderer2();
  const theme = useThemeOptional();
  const color = {
    border: () => theme?.border.base ?? "#7aa2f7",
    busy: () => theme?.text.feedback.warning.base ?? "#e0af68",
    background: () => theme ? theme.decrease(theme.background.raised.base) : "#1a1b26",
    text: () => theme?.text.base ?? "#e6e6e6",
    placeholder: () => theme?.text.faint ?? "#565f89",
    hint: () => theme?.text.muted ?? "#565f89"
  };
  const keyBindings = composerKeyBindings(props.keybinds);
  const [busy, setBusy] = createSignal4(false);
  const [textareaHeight, setTextareaHeight] = createSignal4(1);
  let textarea;
  let disposed = false;
  onCleanup4(() => disposed = true);
  if (props.seam.onSubagentViews) {
    onCleanup4(props.seam.onSubagentViews(() => {}));
  }
  const controller = new ComposerController({
    send: (text) => props.send(text),
    steer: (text) => props.seam.steer(text),
    history: props.history,
    onBusyChange: (value) => {
      if (disposed)
        return;
      setBusy(value);
      props.onBusyChange?.(value);
    }
  });
  const measure = (text) => measureEditText(text, {
    widthMethod: renderer.widthMethod
  });
  const maxLines = () => props.maxHeight ?? 8;
  function syncHeight() {
    if (!textarea || textarea.isDestroyed || disposed)
      return;
    const lines = textarea.editorView.getTotalVirtualLineCount();
    setTextareaHeight(Math.min(maxLines(), Math.max(1, lines)));
  }
  function submit() {
    if (!textarea || textarea.isDestroyed)
      return;
    if (props.interceptSubmit?.(textarea.plainText)) {
      textarea.setText("");
      syncHeight();
      return;
    }
    const result = controller.submit(textarea.plainText);
    if (result !== "ignored")
      textarea.setText("");
  }
  function recall(event) {
    if (!textarea || textarea.isDestroyed)
      return;
    if (props.slashKeyFilter?.(event, textarea.plainText))
      return;
    if (event.ctrl || event.meta || event.shift || event.super)
      return;
    const input = textarea.plainText;
    const row = textarea.scrollY + textarea.visualCursor.visualRow;
    if (event.name === "up") {
      if (textarea.cursorOffset !== 0) {
        if (row !== 0)
          return;
        event.preventDefault();
        textarea.cursorOffset = 0;
        return;
      }
      const item = controller.history.move(-1, input);
      if (item === undefined)
        return;
      event.preventDefault();
      textarea.setText(item);
      textarea.cursorOffset = 0;
      return;
    }
    if (event.name === "down") {
      const end = measure(input);
      if (textarea.cursorOffset !== end) {
        if (row !== Math.max(0, textarea.editorView.getTotalVirtualLineCount() - 1))
          return;
        event.preventDefault();
        textarea.cursorOffset = end;
        return;
      }
      const item = controller.history.move(1, input);
      if (item === undefined)
        return;
      event.preventDefault();
      textarea.setText(item);
      textarea.cursorOffset = measure(item);
    }
  }
  return (() => {
    var _el$ = _$createElement("box"), _el$2 = _$createElement("textarea"), _el$3 = _$createElement("box");
    _$insertNode(_el$, _el$2);
    _$insertNode(_el$, _el$3);
    _$setProp(_el$, "flexShrink", 0);
    _$setProp(_el$, "width", "100%");
    _$setProp(_el$, "flexDirection", "column");
    _$setProp(_el$, "border", ["left"]);
    _$setProp(_el$, "paddingLeft", 1);
    _$insert(_el$, () => props.slashPalette?.(), _el$2);
    _$use((value) => {
      textarea = value;
      queueMicrotask(() => {
        if (value.isDestroyed)
          return;
        value.focus();
      });
      props.ref?.({
        focused: () => !value.isDestroyed && value.focused,
        focus: () => {
          if (value.isDestroyed)
            return;
          value.focus();
        }
      });
    }, _el$2);
    _$setProp(_el$2, "width", "100%");
    _$setProp(_el$2, "minHeight", 1);
    _$setProp(_el$2, "keyBindings", keyBindings);
    _$setProp(_el$2, "onSubmit", submit);
    _$setProp(_el$2, "onKeyDown", recall);
    _$setProp(_el$2, "onContentChange", () => {
      syncHeight();
      if (textarea && !textarea.isDestroyed)
        props.slashSync?.(textarea.plainText);
    });
    _$setProp(_el$2, "onSizeChange", syncHeight);
    _$setProp(_el$3, "height", 1);
    _$setProp(_el$3, "flexShrink", 0);
    _$setProp(_el$3, "flexDirection", "row");
    _$setProp(_el$3, "gap", 2);
    _$insert(_el$3, _$createComponent5(Show2, {
      get when() {
        return busy();
      },
      get fallback() {
        return (() => {
          var _el$6 = _$createElement("text");
          _$insertNode(_el$6, _$createTextNode(`enter send · alt+enter newline · ↑↓ history`));
          _$effect((_$p) => _$setProp(_el$6, "fg", color.hint(), _$p));
          return _el$6;
        })();
      },
      get children() {
        var _el$4 = _$createElement("text");
        _$insertNode(_el$4, _$createTextNode(`* streaming… enter steers the running turn`));
        _$effect((_$p) => _$setProp(_el$4, "fg", color.busy(), _$p));
        return _el$4;
      }
    }));
    _$effect((_p$) => {
      var _v$ = textareaHeight() + FOOTER_HEIGHT + (props.slashHeight?.() ?? 0), _v$2 = busy() ? color.busy() : color.border(), _v$3 = SplitBorder.customBorderChars, _v$4 = color.background(), _v$5 = maxLines(), _v$6 = props.placeholder ?? "Type a message (enter send, alt+enter newline)", _v$7 = color.placeholder(), _v$8 = color.text(), _v$9 = color.text(), _v$0 = color.text();
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$, "height", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$, "borderColor", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp(_el$, "customBorderChars", _v$3, _p$.a));
      _v$4 !== _p$.o && (_p$.o = _$setProp(_el$, "backgroundColor", _v$4, _p$.o));
      _v$5 !== _p$.i && (_p$.i = _$setProp(_el$2, "maxHeight", _v$5, _p$.i));
      _v$6 !== _p$.n && (_p$.n = _$setProp(_el$2, "placeholder", _v$6, _p$.n));
      _v$7 !== _p$.s && (_p$.s = _$setProp(_el$2, "placeholderColor", _v$7, _p$.s));
      _v$8 !== _p$.h && (_p$.h = _$setProp(_el$2, "textColor", _v$8, _p$.h));
      _v$9 !== _p$.r && (_p$.r = _$setProp(_el$2, "focusedTextColor", _v$9, _p$.r));
      _v$0 !== _p$.d && (_p$.d = _$setProp(_el$2, "cursorColor", _v$0, _p$.d));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined,
      s: undefined,
      h: undefined,
      r: undefined,
      d: undefined
    });
    return _el$;
  })();
}

// ../tui-base/src/routes/session/seam-rows.ts
import { createSignal as createSignal5, onCleanup as onCleanup5 } from "solid-js";
import { createStore as createStore4, produce as produce3, reconcile as reconcile3 } from "solid-js/store";
function toStoredRow(stored, index) {
  const kind = stored.kind === "user" || stored.kind === "tool" ? stored.kind : "assistant";
  const key = `stored:${kind}:${index}`;
  if (kind === "tool") {
    return { key, kind: "tool", name: stored.text, args: "", status: "done" };
  }
  if (kind === "user")
    return { key, kind: "user", text: stored.text, final: true };
  return { key, kind: "assistant", text: stored.text, final: stored.final };
}
function createSeamRows(seam, sessionID, options) {
  const [rows, setRows] = createStore4([]);
  const [hydrated, setHydrated] = createSignal5(false);
  let liveOrdinal = 0;
  let turnOpen = false;
  const pendingTurns = [];
  function hydrate(stored) {
    setRows(reconcile3(stored.map(toStoredRow), { key: "key" }));
    setHydrated(true);
  }
  function load() {
    const id = sessionID();
    return seam.storedTranscript(id).then((stored) => {
      if (sessionID() === id)
        hydrate(stored);
    }).catch(() => {
      return;
    });
  }
  function upsert(row) {
    setRows(produce3((draft) => {
      const index = draft.findIndex((existing) => existing.key === row.key);
      if (index === -1) {
        draft.push(row);
        return;
      }
      Object.assign(draft[index], row);
    }));
  }
  function dropRows(keys) {
    setRows(produce3((draft) => {
      for (let i = draft.length - 1;i >= 0; i--) {
        if (keys.has(draft[i].key))
          draft.splice(i, 1);
      }
    }));
  }
  function supersedeSettledTurn(group, settled) {
    setRows(produce3((draft) => {
      const assistantAt = draft.findIndex((row) => row.key === group.assistantKey);
      const doomed = new Set([group.reasoningKey, group.assistantKey]);
      let removedBefore = 0;
      for (let i = draft.length - 1;i >= 0; i--) {
        if (!doomed.has(draft[i].key))
          continue;
        draft.splice(i, 1);
        if (i < assistantAt)
          removedBefore += 1;
      }
      if (settled === undefined)
        return;
      let insertAt = assistantAt === -1 ? draft.length : assistantAt - removedBefore;
      let journalUserAt = -1;
      for (let i = draft.length - 1;i >= insertAt; i--) {
        const row = draft[i];
        if (row.kind === "user" && row.key.startsWith("user:") && !row.key.startsWith("user:local")) {
          journalUserAt = i;
          break;
        }
      }
      if (journalUserAt !== -1) {
        const prompt = draft[journalUserAt];
        draft.splice(journalUserAt, 1);
        draft.splice(insertAt, 0, prompt);
        insertAt += 1;
      }
      draft.splice(insertAt, 0, settled);
    }));
  }
  function apply(event) {
    const details = event.details ?? {};
    if (typeof details.sessionID === "string" && details.sessionID !== sessionID())
      return;
    if (event.type === "message.updated" && details.role === "user") {
      const id = typeof details.id === "string" ? details.id : `local-${++liveOrdinal}`;
      const text = typeof details.text === "string" ? details.text : "";
      if (!turnOpen && pendingTurns.length > 0 && typeof details.sessionID === "string") {
        const group = pendingTurns[0];
        const local = rows.find((row) => row.key === group.userKey);
        if (!local || local.kind !== "user" || local.text.trim() === text.trim()) {
          group.userSuperseded = true;
          dropRows(new Set([group.userKey]));
        }
      }
      upsert({
        key: `user:${id}`,
        kind: "user",
        text,
        final: true
      });
      return;
    }
    if (event.type === "message.part.updated") {
      const messageID = typeof details.messageID === "string" ? details.messageID : "live";
      const part = details.part ?? {};
      const partType = typeof part.type === "string" ? part.type : "text";
      const partID = typeof part.id === "string" ? part.id : `${partType}:${messageID}`;
      if (partType === "tool") {
        upsert({
          key: `tool:${messageID}:${partID}`,
          kind: "tool",
          name: typeof part.name === "string" ? part.name : "generic",
          args: typeof part.input === "string" ? part.input : "",
          status: part.status === "done" || part.status === "failed" ? part.status : "running",
          output: typeof part.output === "string" ? part.output : undefined
        });
        return;
      }
      if (partType !== "text" && partType !== "reasoning")
        return;
      const text = typeof part.text === "string" ? part.text : "";
      const kind = partType === "text" ? "assistant" : "reasoning";
      if (partType === "text" && !turnOpen && pendingTurns.length > 0 && typeof details.sessionID === "string") {
        const group = pendingTurns.shift();
        const settled = text.trim() ? { key: `${kind}:${messageID}:${partID}`, kind: "assistant", text, final: true } : undefined;
        supersedeSettledTurn(group, settled);
        return;
      }
      const key = `${kind}:${messageID}:${partID}`;
      const existing = rows.find((row) => row.key === key);
      if (!existing && !text.trim())
        return;
      upsert({
        key,
        kind,
        text: existing && existing.kind === kind ? existing.text + text : text,
        final: part.time?.completed !== undefined
      });
      return;
    }
    if (event.type === "session.error") {
      const message = typeof details.message === "string" ? details.message : "unknown error";
      upsert({ key: `error:local-${++liveOrdinal}`, kind: "assistant", text: `error: ${message}`, final: true });
    }
  }
  const unsubscribe = seam.onSessionEvent(apply);
  onCleanup5(unsubscribe);
  async function send(text) {
    const prompt = text.trim();
    if (!prompt)
      return;
    const userKey = `user:local-${++liveOrdinal}`;
    upsert({ key: userKey, kind: "user", text: prompt, final: true });
    const assistantKey = `assistant:live-${++liveOrdinal}`;
    const reasoningKey = `reasoning:live-${liveOrdinal}`;
    const group = { userKey, reasoningKey, assistantKey, userSuperseded: false };
    pendingTurns.push(group);
    let assistantText = "";
    let reasoningText = "";
    let turnErrored = false;
    turnOpen = true;
    return seam.turn(prompt, {
      onThinkingDelta: (delta) => {
        reasoningText += delta;
        if (reasoningText.trim())
          upsert({ key: reasoningKey, kind: "reasoning", text: reasoningText, final: false });
      },
      onContentDelta: (delta) => {
        assistantText += delta;
        upsert({ key: assistantKey, kind: "assistant", text: assistantText, final: false });
      },
      onToolStart: (start) => {
        upsert({
          key: `tool:live:${start.callId ?? start.name}`,
          kind: "tool",
          name: start.name,
          args: start.args,
          status: "running"
        });
      },
      onApprove: options?.onApprove ?? approveThrough,
      onError: (message) => {
        turnErrored = true;
        upsert({ key: assistantKey, kind: "assistant", text: `error: ${message}`, final: true });
      }
    }).finally(() => {
      turnOpen = false;
    }).then(() => {
      const finalize = (key, kind, text) => {
        if (kind === "assistant" && turnErrored)
          return;
        const existing = rows.find((row) => row.key === key);
        if (existing && existing.kind === kind)
          upsert({ ...existing, text, final: true });
      };
      finalize(reasoningKey, "reasoning", reasoningText);
      finalize(assistantKey, "assistant", assistantText);
      setRows(produce3((draft) => {
        for (const row of draft) {
          if (row.kind === "tool" && row.status === "running" && row.key.startsWith("tool:live:"))
            row.status = "done";
        }
      }));
      if (turnErrored)
        return;
      const id = sessionID();
      return seam.storedTranscript(id).then((stored) => {
        const nowId = sessionID();
        if (turnOpen || nowId !== id && nowId !== "")
          return;
        const durable = [...stored].reverse().find((row) => row.kind === "assistant" && row.text.trim());
        if (!durable)
          return;
        const live = rows.find((row) => row.key === assistantKey);
        setRows(produce3((draft) => {
          for (let i = draft.length - 1;i >= 0; i--) {
            if (draft[i].key === reasoningKey)
              draft.splice(i, 1);
          }
          if (durable && live && live.kind === "assistant" && live.text !== durable.text) {
            const index = draft.findIndex((row) => row.key === assistantKey);
            if (index !== -1)
              Object.assign(draft[index], { text: durable.text, final: true });
          }
        }));
      }).catch(() => {
        return;
      });
    });
  }
  return { rows, hydrated, load, hydrate, apply, send };
}
async function approveThrough(_name, _args) {
  return "allowed-once";
}

// ../tui-base/src/routes/session/transcript.tsx
import { createTextNode as _$createTextNode2 } from "@opentui/solid";
import { createComponent as _$createComponent6 } from "@opentui/solid";
import { use as _$use2 } from "@opentui/solid";
import { insertNode as _$insertNode2 } from "@opentui/solid";
import { insert as _$insert2 } from "@opentui/solid";
import { effect as _$effect2 } from "@opentui/solid";
import { setProp as _$setProp2 } from "@opentui/solid";
import { createElement as _$createElement2 } from "@opentui/solid";
import { For, onCleanup as onCleanup6, onMount as onMount2, Show as Show3 } from "solid-js";
import { useRenderer as useRenderer3 } from "@opentui/solid";
import { SyntaxStyle as SyntaxStyle2 } from "@opentui/core";
function Transcript(props) {
  const renderer = useRenderer3();
  const theme = useThemeOptional();
  const color = {
    text: () => theme?.text.base ?? "#e6e6e6",
    user: () => theme?.text.action.primary.base ?? "#7aa2f7",
    reasoningBorder: () => theme?.border.base ?? "#565f89",
    reasoning: () => theme?.text.muted ?? "#9aa5ce",
    done: () => theme?.text.feedback.success.base ?? "#9ece6a",
    running: () => theme?.text.feedback.warning.base ?? "#e0af68",
    failed: () => theme?.text.feedback.error.base ?? "#f7768e",
    loading: () => theme?.text.feedback.info.base ?? "#565f89",
    background: () => theme?.background.base ?? "black"
  };
  const sessionID = () => props.sessionID ?? props.seam.currentSessionId() ?? "";
  const owned = props.projection === undefined;
  const projection = props.projection ?? createSeamRows(props.seam, sessionID);
  const themes = useThemesOptional();
  const syntaxStyle = () => props.syntaxStyle ?? themes?.currentSyntax() ?? SyntaxStyle2.fromStyles({}, renderer.nativeScene);
  onMount2(() => {
    if (owned)
      projection.load();
  });
  const assistantRow = (row) => (() => {
    var _el$ = _$createElement2("markdown");
    _$setProp2(_el$, "internalBlockMode", "top-level");
    _$effect2((_p$) => {
      var _v$ = props.renderNode, _v$2 = row.text, _v$3 = !row.final, _v$4 = syntaxStyle(), _v$5 = color.text();
      _v$ !== _p$.e && (_p$.e = _$setProp2(_el$, "renderNode", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp2(_el$, "content", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp2(_el$, "streaming", _v$3, _p$.a));
      _v$4 !== _p$.o && (_p$.o = _$setProp2(_el$, "syntaxStyle", _v$4, _p$.o));
      _v$5 !== _p$.i && (_p$.i = _$setProp2(_el$, "fg", _v$5, _p$.i));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined
    });
    return _el$;
  })();
  const rowView = (row) => {
    switch (row.kind) {
      case "user":
        return (() => {
          var _el$2 = _$createElement2("box"), _el$3 = _$createElement2("text");
          _$insertNode2(_el$2, _el$3);
          _$setProp2(_el$2, "flexShrink", 0);
          _$setProp2(_el$2, "paddingLeft", 3);
          _$setProp2(_el$3, "wrapMode", "word");
          _$insert2(_el$3, () => `❯ ${row.text}`);
          _$effect2((_$p) => _$setProp2(_el$3, "fg", color.user(), _$p));
          return _el$2;
        })();
      case "reasoning":
        return (() => {
          var _el$4 = _$createElement2("box"), _el$5 = _$createElement2("text");
          _$insertNode2(_el$4, _el$5);
          _$setProp2(_el$4, "flexShrink", 0);
          _$setProp2(_el$4, "marginLeft", 3);
          _$setProp2(_el$4, "border", ["left"]);
          _$setProp2(_el$4, "paddingLeft", 1);
          _$setProp2(_el$5, "wrapMode", "word");
          _$insert2(_el$5, () => row.text);
          _$effect2((_p$) => {
            var _v$6 = color.reasoningBorder(), _v$7 = color.reasoning();
            _v$6 !== _p$.e && (_p$.e = _$setProp2(_el$4, "borderColor", _v$6, _p$.e));
            _v$7 !== _p$.t && (_p$.t = _$setProp2(_el$5, "fg", _v$7, _p$.t));
            return _p$;
          }, {
            e: undefined,
            t: undefined
          });
          return _el$4;
        })();
      case "tool":
        return (() => {
          var _el$6 = _$createElement2("box"), _el$7 = _$createElement2("text");
          _$insertNode2(_el$6, _el$7);
          _$setProp2(_el$6, "flexShrink", 0);
          _$setProp2(_el$6, "paddingLeft", 3);
          _$setProp2(_el$7, "wrapMode", "none");
          _$insert2(_el$7, () => `${row.status === "done" ? "✓" : row.status === "failed" ? "✗" : "*"} ${row.name}${row.args ? `(${row.args})` : ""}`);
          _$effect2((_$p) => _$setProp2(_el$7, "fg", row.status === "failed" ? color.failed() : row.status === "running" ? color.running() : color.done(), _$p));
          return _el$6;
        })();
      case "assistant":
        return assistantRow(row);
    }
  };
  onCleanup6(() => {
    props.scrollRef?.(undefined);
  });
  return (() => {
    var _el$8 = _$createElement2("box"), _el$9 = _$createElement2("box"), _el$0 = _$createElement2("box"), _el$1 = _$createElement2("scrollbox");
    _$insertNode2(_el$8, _el$9);
    _$setProp2(_el$8, "flexDirection", "column");
    _$setProp2(_el$8, "flexGrow", 1);
    _$setProp2(_el$8, "minHeight", 0);
    _$setProp2(_el$8, "width", "100%");
    _$insertNode2(_el$9, _el$0);
    _$setProp2(_el$9, "flexDirection", "row");
    _$setProp2(_el$9, "flexGrow", 1);
    _$setProp2(_el$9, "minHeight", 0);
    _$insertNode2(_el$0, _el$1);
    _$setProp2(_el$0, "flexGrow", 1);
    _$setProp2(_el$0, "minHeight", 0);
    _$setProp2(_el$0, "position", "relative");
    _$setProp2(_el$0, "paddingBottom", 1);
    _$use2((value) => {
      props.scrollRef?.(value);
    }, _el$1);
    _$setProp2(_el$1, "flexGrow", 1);
    _$setProp2(_el$1, "overflow", "hidden");
    _$setProp2(_el$1, "stickyScroll", true);
    _$setProp2(_el$1, "stickyStart", "bottom");
    _$insert2(_el$1, _$createComponent6(For, {
      get each() {
        return projection.rows;
      },
      children: (row) => (() => {
        var _el$14 = _$createElement2("box");
        _$setProp2(_el$14, "marginTop", 1);
        _$setProp2(_el$14, "flexShrink", 0);
        _$insert2(_el$14, () => rowView(row));
        _$effect2((_$p) => _$setProp2(_el$14, "id", `seam-row-${row.key}`, _$p));
        return _el$14;
      })()
    }), null);
    _$insert2(_el$1, _$createComponent6(Show3, {
      get when() {
        return projection.hydrated() === false;
      },
      get children() {
        var _el$10 = _$createElement2("box"), _el$11 = _$createElement2("text");
        _$insertNode2(_el$10, _el$11);
        _$setProp2(_el$10, "flexShrink", 0);
        _$insertNode2(_el$11, _$createTextNode2(`Loading session history…`));
        _$effect2((_$p) => _$setProp2(_el$11, "fg", color.loading(), _$p));
        return _el$10;
      }
    }), null);
    _$insert2(_el$8, _$createComponent6(Show3, {
      get when() {
        return props.children;
      },
      get children() {
        var _el$13 = _$createElement2("box");
        _$setProp2(_el$13, "width", "100%");
        _$setProp2(_el$13, "flexShrink", 0);
        _$insert2(_el$13, () => props.children);
        return _el$13;
      }
    }), null);
    _$effect2((_p$) => {
      var _v$8 = color.background(), _v$9 = {
        paddingRight: props.scrollbar ? 1 : 0
      }, _v$0 = {
        paddingLeft: 1,
        visible: props.scrollbar ?? false,
        trackOptions: {
          backgroundColor: color.background(),
          foregroundColor: color.reasoningBorder()
        }
      };
      _v$8 !== _p$.e && (_p$.e = _$setProp2(_el$8, "backgroundColor", _v$8, _p$.e));
      _v$9 !== _p$.t && (_p$.t = _$setProp2(_el$1, "viewportOptions", _v$9, _p$.t));
      _v$0 !== _p$.a && (_p$.a = _$setProp2(_el$1, "verticalScrollbarOptions", _v$0, _p$.a));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined
    });
    return _el$8;
  })();
}

// ../tui-base/src/routes/session/turn-overlay-controller.ts
class TurnOverlayController {
  #approvals = [];
  #asks = [];
  #seq = 0;
  #listeners = new Set;
  #idleHandlers = new Set;
  #busy = false;
  subscribe(fn) {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }
  onIdle(fn) {
    this.#idleHandlers.add(fn);
    return () => this.#idleHandlers.delete(fn);
  }
  #changed() {
    for (const listener of this.#listeners)
      listener();
    const busy = this.#approvals.length > 0 || this.#asks.length > 0;
    if (this.#busy && !busy)
      for (const handler of this.#idleHandlers)
        handler();
    this.#busy = busy;
  }
  get pendingApproval() {
    return this.#approvals[0]?.request;
  }
  requestApproval(name, args) {
    return new Promise((resolve) => {
      this.#approvals.push({ request: { id: ++this.#seq, name, args }, resolve });
      this.#changed();
    });
  }
  confirmApproval() {
    this.#settleApproval("allowed-once");
  }
  rejectApproval() {
    this.#settleApproval("rejected");
  }
  #settleApproval(verdict) {
    const head = this.#approvals.shift();
    if (!head)
      return;
    head.resolve(verdict);
    this.#changed();
  }
  get pendingAsk() {
    const head = this.#asks[0];
    if (!head)
      return;
    return { id: head.id, questions: head.questions, index: head.index, picks: head.picks, phase: head.phase };
  }
  get currentQuestion() {
    const head = this.#asks[0];
    return head?.questions[head.index];
  }
  answer(questions) {
    if (questions.length === 0)
      return Promise.resolve([]);
    return new Promise((resolve) => {
      this.#asks.push({
        id: ++this.#seq,
        questions,
        index: 0,
        picks: questions.map(() => []),
        phase: "questions",
        resolve
      });
      this.#changed();
    });
  }
  toggle(option) {
    const head = this.#asks[0];
    const question = head?.questions[head.index];
    if (!head || !question || head.phase === "review")
      return;
    if (question.multiSelect === true) {
      const current = head.picks[head.index] ?? [];
      head.picks[head.index] = current.includes(option) ? current.filter((label) => label !== option) : [...current, option];
      this.#changed();
      return;
    }
    head.picks[head.index] = [option];
    if (head.questions.length === 1) {
      this.#asks.shift();
      head.resolve(this.#envelope(head));
      this.#changed();
      return;
    }
    if (this.#allAnswered(head)) {
      head.phase = "review";
    } else {
      const next = head.questions.findIndex((_, qi) => qi > head.index && head.picks[qi]?.length === 0);
      if (next >= 0)
        head.index = next;
    }
    this.#changed();
  }
  switchFocus(direction) {
    const head = this.#asks[0];
    if (!head || head.phase === "review" || head.questions.length < 2)
      return;
    const next = Math.max(0, Math.min(head.questions.length - 1, head.index + direction));
    if (next !== head.index) {
      head.index = next;
      this.#changed();
    }
  }
  enterReview() {
    const head = this.#asks[0];
    if (!head || head.phase === "review")
      return false;
    if (!this.#allAnswered(head))
      return false;
    head.phase = "review";
    this.#changed();
    return true;
  }
  backToQuestions(focus) {
    const head = this.#asks[0];
    if (!head || head.phase !== "review")
      return;
    head.phase = "questions";
    if (focus !== undefined && focus >= 0 && focus < head.questions.length)
      head.index = focus;
    this.#changed();
  }
  submit() {
    const head = this.#asks[0];
    if (!head)
      return;
    this.#asks.shift();
    head.resolve(this.#envelope(head));
    this.#changed();
  }
  #allAnswered(head) {
    return head.picks.every((pick) => pick.length > 0);
  }
  #envelope(head) {
    return head.questions.map((question, qi) => {
      const picks = head.picks[qi] ?? [];
      return {
        questionId: question.id,
        selected: picks[0] ?? "",
        ...picks.length > 1 ? { selections: [...picks] } : {}
      };
    });
  }
  decline() {
    const head = this.#asks.shift();
    if (!head)
      return;
    head.resolve([]);
    this.#changed();
  }
}

// ../tui-base/src/routes/session/turn-overlays.tsx
import { memo as _$memo5 } from "@opentui/solid";
import { createComponent as _$createComponent14 } from "@opentui/solid";
import { createEffect as createEffect4, createSignal as createSignal10, onCleanup as onCleanup11, onMount as onMount4, untrack, Show as Show7 } from "solid-js";

// ../tui-base/src/ui/dialog-confirm.tsx
import { insertNode as _$insertNode5 } from "@opentui/solid";
import { createComponent as _$createComponent12 } from "@opentui/solid";
import { setProp as _$setProp5 } from "@opentui/solid";
import { effect as _$effect5 } from "@opentui/solid";
import { insert as _$insert5 } from "@opentui/solid";
import { createElement as _$createElement5 } from "@opentui/solid";

// ../tui-base/src/context/keymap.tsx
import { createComponent as _$createComponent8 } from "@opentui/solid";
import { InputRenderable, TextareaRenderable } from "@opentui/core";
import { stringifyKeyStroke } from "@opentui/keymap";
import { registerBackspacePopsPendingSequence, registerBaseLayoutFallback, registerCommaBindings, registerEscapeClearsPendingSequence, registerManagedTextareaLayer, registerTimedLeader } from "@opentui/keymap/addons/opentui";
import { formatCommandBindings, formatKeySequence } from "@opentui/keymap/extras";
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui";
import { KeymapProvider, useBindings, useKeymapSelector } from "@opentui/keymap/solid";
import { useRenderer as useRenderer4 } from "@opentui/solid";
import { createComputed, createContext as createContext6, createMemo as createMemo4, createSignal as createSignal6, onCleanup as onCleanup7, useContext as useContext7 } from "solid-js";

// ../tui-base/src/context/interactivity.tsx
import { createComponent as _$createComponent7 } from "@opentui/solid";
import { createContext as createContext5, createMemo as createMemo3, getOwner, useContext as useContext6 } from "solid-js";
var Context3 = createContext5(() => true);
function useInteractivity() {
  return useContext6(Context3);
}
function resolveInteractivity(fallback) {
  return getOwner() ? useInteractivity() : fallback;
}

// ../tui-base/src/context/keymap.tsx
var MODE = {
  key: "opencode.mode",
  base: "base"
};
var Context4 = createContext6();
function Provider(props) {
  const renderer = useRenderer4();
  const config = props.config ?? useConfig().data;
  const keymap = createDefaultOpenTuiKeymap(renderer);
  const mode = createMode(keymap);
  let invocation;
  const dispatch = (id, input) => {
    const previous = invocation;
    invocation = {
      id,
      input
    };
    try {
      keymap.dispatchCommand(id);
    } finally {
      invocation = previous;
    }
  };
  const dispose = [registerCommaBindings(keymap), keymap.appendBindingExpander((context) => {
    const key = Object.entries({
      enter: "return",
      esc: "escape",
      pgdown: "pagedown",
      pgup: "pageup"
    }).reduce((result, [alias, value]) => result.replace(new RegExp(`(^|[+,\\s>])${alias}(?=$|[+,\\s<])`, "gi"), `$1${value}`), context.input);
    if (key === context.input)
      return;
    return [{
      key,
      displays: context.displays
    }];
  }), registerBaseLayoutFallback(keymap), registerEscapeClearsPendingSequence(keymap), registerBackspacePopsPendingSequence(keymap), registerManagedTextareaLayer(keymap, renderer, {
    enabled: () => {
      const editor = renderer.currentFocusedEditor;
      return editor instanceof TextareaRenderable && !(editor instanceof InputRenderable);
    },
    bindings: ["input.move.left", "input.move.right", "input.move.up", "input.move.down", "input.select.left", "input.select.right", "input.select.up", "input.select.down", "input.line.home", "input.line.end", "input.select.line.home", "input.select.line.end", "input.visual.line.home", "input.visual.line.end", "input.select.visual.line.home", "input.select.visual.line.end", "input.buffer.home", "input.buffer.end", "input.select.buffer.home", "input.select.buffer.end", "input.delete.line", "input.delete.to.line.end", "input.delete.to.line.start", "input.backspace", "input.delete", "input.newline", "input.undo", "input.redo", "input.word.forward", "input.word.backward", "input.select.word.forward", "input.select.word.backward", "input.delete.word.forward", "input.delete.word.backward", "input.select.all", "input.submit"].flatMap((command) => config.keybinds.get(command))
  })];
  const leader = config.keybinds.get("leader")?.[0]?.key;
  if (leader) {
    dispose.push(registerTimedLeader(keymap, {
      trigger: leader,
      name: "leader",
      timeoutMs: config.leader?.timeout ?? ("leader_timeout" in config ? config.leader_timeout : undefined) ?? 2000
    }));
  }
  onCleanup7(() => {
    dispose.reverse().forEach((item) => item());
    mode.dispose();
  });
  return _$createComponent8(KeymapProvider, {
    keymap,
    get children() {
      return _$createComponent8(Context4.Provider, {
        value: {
          keymap,
          config,
          mode,
          dispatch,
          input: (id) => invocation?.id === id ? invocation.input : undefined
        },
        get children() {
          return props.children;
        }
      });
    }
  });
}
function use() {
  const value = useValue();
  const enabled = useInteractivity();
  const leader = value.config.keybinds.get("leader")?.[0]?.key;
  const isLeader = leader ? value.keymap.createKeyMatcher(leader) : () => false;
  return {
    dispatch(id, input) {
      value.dispatch(id, input);
    },
    mode: {
      current: value.mode.current,
      push: (mode, active) => {
        const interactive = resolveInteractivity(enabled);
        return value.mode.push(mode, active ? () => interactive() && active() : interactive);
      }
    },
    intercept: value.keymap.intercept.bind(value.keymap),
    isLeader
  };
}
function createLayer(input) {
  const value = useValue();
  const enabled = useInteractivity();
  const stable = new Map;
  useBindings(() => {
    const layer = input();
    const {
      commands,
      bindings,
      mode,
      ...options
    } = layer;
    const grouped = groupCommands(commands);
    return {
      ...options,
      enabled: enabled() ? options.enabled : false,
      ...mode === "global" ? {} : {
        mode: mode ?? MODE.base
      },
      commands: grouped.named.map((command) => {
        const previous = stable.get(command.id);
        if (previous && sameData(previous, command))
          Object.assign(previous, Object.fromEntries(Object.entries(command).filter(([, value]) => typeof value === "function")));
        else
          stable.set(command.id, command);
        const kept = stable.get(command.id);
        const {
          id,
          description,
          group,
          palette,
          bind,
          run,
          ...definition
        } = kept;
        return {
          ...definition,
          name: id,
          opencode: kept,
          run: (context) => run(value.input(id), context.event),
          ...description === undefined ? {} : {
            desc: description
          },
          ...group === undefined ? {} : {
            category: group
          },
          ...palette === undefined ? {} : {
            namespace: "palette"
          }
        };
      }),
      bindings: [...grouped.inline.map((command) => ({
        key: command.bind,
        cmd: () => {
          if (command.enabled === false)
            return false;
          if (typeof command.enabled === "function" && !command.enabled())
            return false;
          return command.run();
        },
        ...command.title === undefined && command.description === undefined ? {} : {
          desc: command.title ?? command.description
        },
        ...command.group === undefined ? {} : {
          group: command.group
        }
      })), ...grouped.named.flatMap((command) => {
        if (command.bind === false)
          return [];
        const configured = value.config.keybinds.get(command.id);
        if (configured.length)
          return configured;
        if (typeof command.bind !== "string")
          return [];
        return [{
          key: command.bind,
          cmd: command.id
        }];
      }), ...(bindings ?? []).flatMap((id) => value.config.keybinds.get(id))]
    };
  });
}
function sameData(previous, next) {
  const keys = Object.keys(next);
  return keys.length === Object.keys(previous).length && keys.every((key) => typeof next[key] === "function" ? typeof previous[key] === "function" : Object.hasOwn(previous, key) && sameValue(previous[key], next[key]));
}
function sameValue(previous, next) {
  if (Object.is(previous, next))
    return true;
  if (typeof previous !== "object" || typeof next !== "object" || previous === null || next === null)
    return false;
  if (Array.isArray(previous) !== Array.isArray(next))
    return false;
  const before = previous;
  const after = next;
  const keys = Object.keys(after);
  return keys.length === Object.keys(before).length && keys.every((key) => Object.hasOwn(before, key) && sameValue(before[key], after[key]));
}
function groupCommands(commands = []) {
  return commands.reduce((result, command) => {
    if (command.id !== undefined) {
      if (!command.id)
        throw new Error("Keymap command IDs cannot be empty");
      if (typeof command.bind === "string" && !command.bind)
        throw new Error("Keymap command bindings cannot be empty");
      result.named.push({
        ...command,
        id: command.id
      });
      return result;
    }
    if (command.palette)
      throw new Error("Palette commands require an ID");
    if (command.slash)
      throw new Error("Slash commands require an ID");
    if (typeof command.bind !== "string")
      throw new Error("Inline keymap commands require bind");
    if (!command.bind)
      throw new Error("Keymap command bindings cannot be empty");
    result.inline.push({
      ...command,
      id: undefined,
      bind: command.bind
    });
    return result;
  }, {
    named: [],
    inline: []
  });
}
function useShortcuts() {
  const value = useValue();
  const shortcuts = useKeymapSelector((keymap) => {
    const commands = keymap.getCommands({
      visibility: "registered"
    }).map((command) => command.name);
    const bindings = keymap.getCommandBindings({
      visibility: "registered",
      commands
    });
    return new Map(commands.map((id) => {
      const current = bindings.get(id) ?? [];
      return [id, {
        first: formatKeySequence(current[0]?.sequence, formatOptions(value.config)),
        all: formatCommandBindings(current, formatOptions(value.config)),
        list: current.map((binding) => formatKeySequence(binding.sequence, formatOptions(value.config))).filter((shortcut) => shortcut !== undefined)
      }];
    }));
  });
  return {
    get(id) {
      return shortcuts().get(id)?.first;
    },
    all(id) {
      return shortcuts().get(id)?.all;
    },
    list(id) {
      return shortcuts().get(id)?.list ?? [];
    }
  };
}
function useShortcut(id) {
  const shortcuts = useShortcuts();
  return () => shortcuts.get(id);
}
function useLeaderActive() {
  const pending = usePendingSequence();
  return () => pending()[0]?.tokenName === "leader";
}
function useCommands() {
  const value = useValue();
  return useKeymapSelector((keymap) => keymap.getCommandEntries({
    visibility: "reachable"
  }).map((entry) => {
    const command = entry.command.opencode ?? {
      id: entry.command.name,
      title: typeof entry.command.title === "string" ? entry.command.title : undefined,
      description: typeof entry.command.desc === "string" ? entry.command.desc : undefined,
      group: typeof entry.command.category === "string" ? entry.command.category : undefined,
      enabled: typeof entry.command.enabled === "boolean" || typeof entry.command.enabled === "function" ? entry.command.enabled : undefined,
      palette: entry.command.namespace === "palette" ? true : undefined,
      slash: entry.command.slash,
      suggested: typeof entry.command.suggested === "boolean" || typeof entry.command.suggested === "function" ? entry.command.suggested : undefined
    };
    return {
      ...command,
      run: (input) => {
        value.dispatch(entry.command.name, input);
      }
    };
  }));
}
function usePendingSequence() {
  useValue();
  return useKeymapSelector((keymap) => keymap.getPendingSequence());
}
function useActiveKeys() {
  useValue();
  return useKeymapSelector((keymap) => keymap.getActiveKeys({
    includeMetadata: true
  }));
}
function useState() {
  const value = useValue();
  const commands = useCommands();
  const pending = usePendingSequence();
  const active = useActiveKeys();
  return {
    commands,
    pending: () => pending().map((item) => ({
      key: formatKeySequence([item], formatOptions(value.config)) ?? "",
      ...item.tokenName ? {
        token: item.tokenName
      } : {}
    })),
    active: () => active().map((item) => ({
      key: formatKeySequence([{
        stroke: item.stroke,
        display: item.display,
        tokenName: item.tokenName
      }], formatOptions(value.config)) ?? "",
      ...typeof item.commandAttrs?.title === "string" ? {
        title: item.commandAttrs.title
      } : {},
      ...typeof item.bindingAttrs?.desc === "string" ? {
        description: item.bindingAttrs.desc
      } : typeof item.commandAttrs?.desc === "string" ? {
        description: item.commandAttrs.desc
      } : {},
      ...typeof item.commandAttrs?.category === "string" ? {
        group: item.commandAttrs.category
      } : typeof item.bindingAttrs?.group === "string" ? {
        group: item.bindingAttrs.group
      } : {},
      continues: item.continues
    }))
  };
}
function useValue() {
  const value = useContext7(Context4);
  if (!value)
    throw new Error("Keymap.Provider is missing");
  return value;
}
var Keymap = {
  Provider,
  use,
  createLayer,
  validateCommands: (commands) => void groupCommands(commands),
  useShortcuts,
  useShortcut,
  useLeaderActive,
  useCommands,
  usePendingSequence,
  useActiveKeys,
  useState
};
function createMode(keymap) {
  const [stack, setStack] = createSignal6([]);
  const current = createMemo4(() => stack().findLast((item) => item.enabled())?.mode ?? MODE.base);
  createComputed(() => keymap.setData(MODE.key, current()));
  const unregister = keymap.registerLayerFields({
    mode(value, context) {
      context.require(MODE.key, value);
    }
  });
  let disposed = false;
  return {
    current,
    push(mode, enabled) {
      if (disposed)
        return () => {};
      const id = Symbol(mode);
      setStack((items) => [...items, {
        id,
        mode,
        enabled
      }]);
      return () => {
        setStack((items) => items.filter((item) => item.id !== id));
      };
    },
    dispose() {
      if (disposed)
        return;
      disposed = true;
      setStack([]);
      unregister();
      keymap.setData(MODE.key, undefined);
    }
  };
}
function formatOptions(config) {
  const leader = config.keybinds.get("leader")?.[0]?.key;
  return {
    tokenDisplay: {
      leader: leader ? typeof leader === "string" ? leader : stringifyKeyStroke(leader) : LeaderDefault
    },
    keyNameAliases: {
      up: "↑",
      down: "↓",
      left: "←",
      right: "→",
      pageup: "pgup",
      pagedown: "pgdn",
      delete: "del"
    },
    modifierAliases: {
      meta: "alt"
    }
  };
}

// ../tui-base/src/ui/dialog.tsx
import { memo as _$memo3 } from "@opentui/solid";
import { createComponent as _$createComponent11 } from "@opentui/solid";
import { effect as _$effect4 } from "@opentui/solid";
import { insertNode as _$insertNode4 } from "@opentui/solid";
import { insert as _$insert4 } from "@opentui/solid";
import { setProp as _$setProp4 } from "@opentui/solid";
import { createElement as _$createElement4 } from "@opentui/solid";
import { useRenderer as useRenderer6, useTerminalDimensions as useTerminalDimensions2 } from "@opentui/solid";
import { batch as batch2, children, createContext as createContext9, createEffect as createEffect2, createSignal as createSignal8, For as For2, onCleanup as onCleanup9, Show as Show5, useContext as useContext10 } from "solid-js";
import { InputRenderable as InputRenderable2, MouseButton, RGBA as RGBA7, TextAttributes as TextAttributes2 } from "@opentui/core";
import { createStore as createStore6 } from "solid-js/store";

// ../tui-base/src/ui/toast.tsx
import { createTextNode as _$createTextNode3 } from "@opentui/solid";
import { createComponent as _$createComponent9 } from "@opentui/solid";
import { insertNode as _$insertNode3 } from "@opentui/solid";
import { effect as _$effect3 } from "@opentui/solid";
import { insert as _$insert3 } from "@opentui/solid";
import { memo as _$memo2 } from "@opentui/solid";
import { setProp as _$setProp3 } from "@opentui/solid";
import { createElement as _$createElement3 } from "@opentui/solid";
import { createContext as createContext7, createSignal as createSignal7, onCleanup as onCleanup8, useContext as useContext8, Show as Show4 } from "solid-js";
import { createStore as createStore5 } from "solid-js/store";
import { useRenderer as useRenderer5, useTerminalDimensions } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";

// ../tui-base/src/util/record.ts
function isRecord3(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// ../tui-base/src/util/error.ts
function errorFormat(error) {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }
  if (typeof error === "object" && error !== null) {
    try {
      const json = JSON.stringify(error, null, 2);
      if (json === "{}") {
        const str = String(error);
        if (str && str !== "[object Object]")
          return str;
        const ctor = error.constructor?.name;
        const prefix = ctor && ctor !== "Object" ? ctor : "Error";
        const names = Object.getOwnPropertyNames(error);
        return names.length === 0 ? `${prefix} (no message)` : `${prefix} { ${names.join(", ")} }`;
      }
      return json;
    } catch {
      return "Unexpected error (unserializable)";
    }
  }
  return String(error);
}
function errorMessage(error) {
  if (error instanceof Error) {
    if (error.message)
      return error.message;
    if (error.name)
      return error.name;
  }
  if (isRecord3(error) && typeof error.message === "string" && error.message) {
    return error.message;
  }
  if (isRecord3(error) && isRecord3(error.data) && typeof error.data.message === "string" && error.data.message) {
    return error.data.message;
  }
  const text = String(error);
  if (text && text !== "[object Object]")
    return text;
  const formatted = errorFormat(error);
  if (formatted)
    return formatted;
  return "unknown error";
}

// ../tui-base/src/ui/toast.tsx
function init() {
  const [store, setStore] = createStore5({
    currentToast: null,
    queue: []
  });
  let timeoutHandle = null;
  let startedAt = 0;
  let remaining = 0;
  let paused = false;
  const clear = () => {
    if (!timeoutHandle)
      return;
    clearTimeout(timeoutHandle);
    timeoutHandle = null;
  };
  const start = (duration) => {
    clear();
    remaining = duration;
    startedAt = Date.now();
    timeoutHandle = setTimeout(() => dismiss(), duration).unref();
  };
  const dismiss = () => {
    clear();
    const next = store.queue[0];
    setStore("queue", (queue) => queue.slice(1));
    setStore("currentToast", next ?? null);
    if (!next) {
      paused = false;
      return;
    }
    remaining = next.duration;
    if (!paused)
      start(next.duration);
  };
  const toast = {
    show(options) {
      const toastOptions = {
        ...options,
        duration: options.duration ?? 5000
      };
      if (store.currentToast && (paused || store.queue.length > 0)) {
        setStore("queue", (queue) => [...queue, toastOptions]);
        return;
      }
      setStore("currentToast", toastOptions);
      start(toastOptions.duration);
    },
    error: (err) => {
      toast.show({
        variant: "error",
        message: errorMessage(err)
      });
    },
    pause() {
      if (!store.currentToast || paused)
        return;
      paused = true;
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
      clear();
    },
    resume() {
      if (!store.currentToast || !paused)
        return;
      paused = false;
      start(remaining);
    },
    dismiss,
    activate() {
      const action = store.currentToast?.action;
      dismiss();
      action?.run();
    },
    get currentToast() {
      return store.currentToast;
    },
    get pending() {
      return store.queue.length;
    }
  };
  onCleanup8(clear);
  return toast;
}
var ctx = createContext7();
function ToastProvider(props) {
  const value = init();
  return _$createComponent9(ctx.Provider, {
    value,
    get children() {
      return props.children;
    }
  });
}
function useToast() {
  const value = useContext8(ctx);
  if (!value) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return value;
}

// ../tui-base/src/context/clipboard.tsx
import { createComponent as _$createComponent10 } from "@opentui/solid";
import { createContext as createContext8, useContext as useContext9 } from "solid-js";
var ClipboardContext = createContext8();
function ClipboardProvider(props) {
  return _$createComponent10(ClipboardContext.Provider, {
    get value() {
      return props.value;
    },
    get children() {
      return props.children;
    }
  });
}
function useClipboard() {
  const value = useContext9(ClipboardContext);
  if (!value)
    throw new Error("useClipboard must be used within a ClipboardProvider");
  return value;
}

// ../tui-base/src/util/selection.ts
function copyOnSelectRelease(event, renderer, toast, clipboard) {
  if (!event.isDragging)
    return false;
  return copy2(renderer, toast, clipboard);
}
function copy2(renderer, toast, clipboard) {
  const selection = renderer.getSelection();
  if (!selection)
    return false;
  if (selection.isStart && selection.behavior === "cell")
    return false;
  const text = selection.getSelectedText();
  if (!text)
    return false;
  const focus = renderer.currentFocusedRenderable;
  const clipboardText = focus?.getClipboardText && selection.selectedRenderables.includes(focus) ? focus.getClipboardText(text) : text;
  clipboard.write(clipboardText).then(() => toast.show({ message: "Copied to clipboard", variant: "info" })).catch(toast.error);
  return true;
}

// ../tui-base/src/ui/dialog.tsx
var DIALOG_INSET = 3;
var DIALOG_LIST_INSET = DIALOG_INSET + 1;
function dialogWidth(size) {
  if (size === "xlarge")
    return 116;
  if (size === "large")
    return 88;
  return 60;
}
function Dialog(props) {
  const dimensions = useTerminalDimensions2();
  const theme = useTheme().surface("dialog");
  const renderer = useRenderer6();
  let dismiss = false;
  return _$createComponent11(ThemeContextProvider, {
    context: "dialog",
    get children() {
      var _el$ = _$createElement4("box"), _el$2 = _$createElement4("box");
      _$insertNode4(_el$, _el$2);
      _$setProp4(_el$, "onMouseDown", () => {
        dismiss = !!renderer.getSelection();
      });
      _$setProp4(_el$, "onMouseUp", () => {
        if (dismiss) {
          dismiss = false;
          return;
        }
        props.onClose?.();
      });
      _$setProp4(_el$, "alignItems", "center");
      _$setProp4(_el$, "position", "absolute");
      _$setProp4(_el$, "zIndex", 3000);
      _$setProp4(_el$, "left", 0);
      _$setProp4(_el$, "top", 0);
      _$setProp4(_el$2, "onMouseUp", (e) => {
        if (renderer.getSelection()?.getSelectedText())
          return;
        dismiss = false;
        e.stopPropagation();
      });
      _$setProp4(_el$2, "paddingTop", 1);
      _$insert4(_el$2, () => props.children);
      _$effect4((_p$) => {
        var _v$ = dimensions().width, _v$2 = dimensions().height, _v$3 = props.centered ? "center" : undefined, _v$4 = props.centered ? 0 : dimensions().height / 4, _v$5 = RGBA7.fromInts(0, 0, 0, 150), _v$6 = dialogWidth(props.size ?? "medium"), _v$7 = dimensions().width - 2, _v$8 = theme.background.base;
        _v$ !== _p$.e && (_p$.e = _$setProp4(_el$, "width", _v$, _p$.e));
        _v$2 !== _p$.t && (_p$.t = _$setProp4(_el$, "height", _v$2, _p$.t));
        _v$3 !== _p$.a && (_p$.a = _$setProp4(_el$, "justifyContent", _v$3, _p$.a));
        _v$4 !== _p$.o && (_p$.o = _$setProp4(_el$, "paddingTop", _v$4, _p$.o));
        _v$5 !== _p$.i && (_p$.i = _$setProp4(_el$, "backgroundColor", _v$5, _p$.i));
        _v$6 !== _p$.n && (_p$.n = _$setProp4(_el$2, "width", _v$6, _p$.n));
        _v$7 !== _p$.s && (_p$.s = _$setProp4(_el$2, "maxWidth", _v$7, _p$.s));
        _v$8 !== _p$.h && (_p$.h = _$setProp4(_el$2, "backgroundColor", _v$8, _p$.h));
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined,
        o: undefined,
        i: undefined,
        n: undefined,
        s: undefined,
        h: undefined
      });
      return _el$;
    }
  });
}
function DialogHeader(props) {
  const dialog = useDialog();
  const theme = useTheme().surface("dialog");
  const newDesigns = useNewDesigns();
  const row = () => (() => {
    var _el$3 = _$createElement4("box"), _el$4 = _$createElement4("text");
    _$insertNode4(_el$3, _el$4);
    _$setProp4(_el$3, "flexDirection", "row");
    _$setProp4(_el$3, "justifyContent", "space-between");
    _$insert4(_el$3, () => props.titleView ?? (() => {
      var _el$5 = _$createElement4("text");
      _$insert4(_el$5, () => props.title);
      _$effect4((_p$) => {
        var _v$1 = newDesigns() ? undefined : TextAttributes2.BOLD, _v$10 = theme.text.base;
        _v$1 !== _p$.e && (_p$.e = _$setProp4(_el$5, "attributes", _v$1, _p$.e));
        _v$10 !== _p$.t && (_p$.t = _$setProp4(_el$5, "fg", _v$10, _p$.t));
        return _p$;
      }, {
        e: undefined,
        t: undefined
      });
      return _el$5;
    })(), _el$4);
    _$insert4(_el$3, () => props.children, _el$4);
    _$setProp4(_el$4, "flexShrink", 0);
    _$setProp4(_el$4, "onMouseUp", () => (props.onClose ?? dialog.clear)());
    _$insert4(_el$4, () => props.closeLabel ?? "esc");
    _$effect4((_p$) => {
      var _v$9 = props.gap, _v$0 = theme.text.muted;
      _v$9 !== _p$.e && (_p$.e = _$setProp4(_el$3, "gap", _v$9, _p$.e));
      _v$0 !== _p$.t && (_p$.t = _$setProp4(_el$4, "fg", _v$0, _p$.t));
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$3;
  })();
  return _$createComponent11(Show5, {
    get when() {
      return _$memo3(() => !!newDesigns())() && props.description;
    },
    get fallback() {
      return row();
    },
    get children() {
      var _el$6 = _$createElement4("box"), _el$7 = _$createElement4("text");
      _$insertNode4(_el$6, _el$7);
      _$insert4(_el$6, row, _el$7);
      _$setProp4(_el$7, "wrapMode", "word");
      _$insert4(_el$7, () => props.description);
      _$effect4((_$p) => _$setProp4(_el$7, "fg", theme.text.muted, _$p));
      return _el$6;
    }
  });
}
function DialogLayout(props) {
  const inset = () => props.inset ?? DIALOG_INSET;
  const newDesigns = useNewDesigns();
  return (() => {
    var _el$8 = _$createElement4("box"), _el$9 = _$createElement4("box");
    _$insertNode4(_el$8, _el$9);
    _$setProp4(_el$8, "paddingBottom", 1);
    _$setProp4(_el$8, "gap", 1);
    _$insert4(_el$8, () => props.header, _el$9);
    _$insert4(_el$9, () => props.children);
    _$insert4(_el$8, _$createComponent11(Show5, {
      get when() {
        return newDesigns() || props.legacyFooter === undefined;
      },
      get fallback() {
        return props.legacyFooter;
      },
      get children() {
        return _$createComponent11(Show5, {
          get when() {
            return props.footer;
          },
          children: (footer) => _$createComponent11(DialogFooter, {
            get actions() {
              return footer().actions;
            },
            get inset() {
              return footer().inset;
            },
            get children() {
              return footer().children;
            }
          })
        });
      }
    }), null);
    _$effect4((_p$) => {
      var _v$11 = props.id, _v$12 = inset(), _v$13 = inset(), _v$14 = newDesigns() && props.footer ? (props.footerGap ?? 1) - 1 : 0;
      _v$11 !== _p$.e && (_p$.e = _$setProp4(_el$8, "id", _v$11, _p$.e));
      _v$12 !== _p$.t && (_p$.t = _$setProp4(_el$8, "paddingLeft", _v$12, _p$.t));
      _v$13 !== _p$.a && (_p$.a = _$setProp4(_el$8, "paddingRight", _v$13, _p$.a));
      _v$14 !== _p$.o && (_p$.o = _$setProp4(_el$9, "paddingBottom", _v$14, _p$.o));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined
    });
    return _el$8;
  })();
}
function DialogBleed(props) {
  return (() => {
    var _el$0 = _$createElement4("box");
    _$setProp4(_el$0, "marginLeft", -3);
    _$setProp4(_el$0, "marginRight", -3);
    _$insert4(_el$0, () => props.children);
    return _el$0;
  })();
}
function DialogFooter(props) {
  const dimensions = useTerminalDimensions2();
  const shortcuts = Keymap.useShortcuts();
  const theme = useTheme().surface("dialog");
  const newDesigns = useNewDesigns();
  const narrow = () => dimensions().width < 60;
  const resolve = (actions = []) => actions.flatMap((action) => {
    if (action.key !== undefined || action.command === undefined)
      return [action];
    const key = shortcuts.get(action.command);
    return key ? [{
      ...action,
      key
    }] : [];
  });
  const secondary = () => resolve(props.actions?.secondary);
  const primary = () => resolve(props.actions?.primary);
  const content = children(() => props.children);
  const band = () => newDesigns() && (secondary().length > 0 || primary().length > 0 || content.toArray().length > 0);
  const bandInset = () => DIALOG_INSET + (props.inset ?? 0) - 1;
  return (() => {
    var _el$1 = _$createElement4("box"), _el$10 = _$createElement4("box"), _el$11 = _$createElement4("box");
    _$insertNode4(_el$1, _el$10);
    _$insertNode4(_el$1, _el$11);
    _$setProp4(_el$1, "flexDirection", "row");
    _$setProp4(_el$1, "justifyContent", "space-between");
    _$setProp4(_el$1, "flexShrink", 0);
    _$insert4(_el$10, content, null);
    _$insert4(_el$10, _$createComponent11(For2, {
      get each() {
        return secondary();
      },
      children: (action) => _$createComponent11(DialogFooterItem, {
        action,
        variant: "secondary"
      })
    }), null);
    _$setProp4(_el$11, "flexDirection", "row");
    _$insert4(_el$11, _$createComponent11(For2, {
      get each() {
        return primary();
      },
      children: (action) => _$createComponent11(DialogFooterItem, {
        action,
        variant: "primary"
      })
    }));
    _$effect4((_p$) => {
      var _v$15 = band() ? -DIALOG_INSET : undefined, _v$16 = band() ? -DIALOG_INSET : undefined, _v$17 = band() ? -1 : undefined, _v$18 = band() ? bandInset() : props.inset, _v$19 = band() ? bandInset() : props.inset, _v$20 = band() ? 1 : undefined, _v$21 = band() ? 1 : undefined, _v$22 = band() ? theme.background.raised.high : undefined, _v$23 = newDesigns() ? 2 : undefined, _v$24 = narrow() ? "column" : "row", _v$25 = narrow() || newDesigns() ? 0 : 2, _v$26 = newDesigns() && !narrow() ? 1 : undefined, _v$27 = newDesigns() ? "wrap" : undefined, _v$28 = newDesigns() ? 1 : undefined, _v$29 = newDesigns() ? 0 : undefined, _v$30 = newDesigns() ? 1 : 2, _v$31 = newDesigns() ? 0 : undefined;
      _v$15 !== _p$.e && (_p$.e = _$setProp4(_el$1, "marginLeft", _v$15, _p$.e));
      _v$16 !== _p$.t && (_p$.t = _$setProp4(_el$1, "marginRight", _v$16, _p$.t));
      _v$17 !== _p$.a && (_p$.a = _$setProp4(_el$1, "marginBottom", _v$17, _p$.a));
      _v$18 !== _p$.o && (_p$.o = _$setProp4(_el$1, "paddingLeft", _v$18, _p$.o));
      _v$19 !== _p$.i && (_p$.i = _$setProp4(_el$1, "paddingRight", _v$19, _p$.i));
      _v$20 !== _p$.n && (_p$.n = _$setProp4(_el$1, "paddingTop", _v$20, _p$.n));
      _v$21 !== _p$.s && (_p$.s = _$setProp4(_el$1, "paddingBottom", _v$21, _p$.s));
      _v$22 !== _p$.h && (_p$.h = _$setProp4(_el$1, "backgroundColor", _v$22, _p$.h));
      _v$23 !== _p$.r && (_p$.r = _$setProp4(_el$1, "gap", _v$23, _p$.r));
      _v$24 !== _p$.d && (_p$.d = _$setProp4(_el$10, "flexDirection", _v$24, _p$.d));
      _v$25 !== _p$.l && (_p$.l = _$setProp4(_el$10, "gap", _v$25, _p$.l));
      _v$26 !== _p$.u && (_p$.u = _$setProp4(_el$10, "columnGap", _v$26, _p$.u));
      _v$27 !== _p$.c && (_p$.c = _$setProp4(_el$10, "flexWrap", _v$27, _p$.c));
      _v$28 !== _p$.w && (_p$.w = _$setProp4(_el$10, "flexShrink", _v$28, _p$.w));
      _v$29 !== _p$.m && (_p$.m = _$setProp4(_el$10, "minWidth", _v$29, _p$.m));
      _v$30 !== _p$.f && (_p$.f = _$setProp4(_el$11, "gap", _v$30, _p$.f));
      _v$31 !== _p$.y && (_p$.y = _$setProp4(_el$11, "flexShrink", _v$31, _p$.y));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined,
      s: undefined,
      h: undefined,
      r: undefined,
      d: undefined,
      l: undefined,
      u: undefined,
      c: undefined,
      w: undefined,
      m: undefined,
      f: undefined,
      y: undefined
    });
    return _el$1;
  })();
}
function DialogFooterItem(props) {
  const theme = useTheme().surface("dialog");
  const newDesigns = useNewDesigns();
  const [hovered, setHovered] = createSignal8(false);
  const trigger = () => {
    if (props.action.disabled)
      return;
    props.action.onTrigger?.();
  };
  const label = (key) => [(() => {
    var _el$12 = _$createElement4("span");
    _$insert4(_el$12, () => props.action.title);
    _$effect4((_$p) => _$setProp4(_el$12, "style", {
      fg: props.action.disabled ? theme.text.action.primary.disabled : props.action.color ?? theme.text.base
    }, _$p));
    return _el$12;
  })(), _$createComponent11(Show5, {
    get when() {
      return props.action.key;
    },
    get children() {
      var _el$13 = _$createElement4("span");
      _$insert4(_el$13, () => " " + props.action.key);
      _$effect4((_$p) => _$setProp4(_el$13, "style", {
        fg: props.action.disabled ? theme.text.action.primary.disabled : props.action.color ?? key
      }, _$p));
      return _el$13;
    }
  })];
  return _$createComponent11(Show5, {
    get when() {
      return newDesigns();
    },
    get fallback() {
      return (() => {
        var _el$16 = _$createElement4("text");
        _$setProp4(_el$16, "onMouseUp", trigger);
        _$insert4(_el$16, () => label(theme.text.muted));
        return _el$16;
      })();
    },
    get children() {
      var _el$14 = _$createElement4("box"), _el$15 = _$createElement4("text");
      _$insertNode4(_el$14, _el$15);
      _$setProp4(_el$14, "paddingLeft", 1);
      _$setProp4(_el$14, "paddingRight", 1);
      _$setProp4(_el$14, "flexShrink", 0);
      _$setProp4(_el$14, "onMouseOver", () => setHovered(true));
      _$setProp4(_el$14, "onMouseOut", () => setHovered(false));
      _$setProp4(_el$14, "onMouseUp", trigger);
      _$insert4(_el$15, () => label(theme.text.muted));
      _$effect4((_$p) => _$setProp4(_el$14, "backgroundColor", hovered() && !props.action.disabled ? theme.background.action[props.variant].hovered : undefined, _$p));
      return _el$14;
    }
  });
}
function init2() {
  const [store, setStore] = createStore6({
    stack: [],
    size: "medium",
    centered: false
  });
  const renderer = useRenderer6();
  const keymap = Keymap.use();
  createEffect2(() => {
    if (store.stack.length === 0)
      return;
    const popMode = keymap.mode.push("modal");
    onCleanup9(popMode);
  });
  let focus;
  function refocus() {
    setTimeout(() => {
      if (store.stack.length > 0)
        return;
      if (!focus)
        return;
      if (focus.isDestroyed)
        return;
      function find(item) {
        for (const child of item.getChildren()) {
          if (child === focus)
            return true;
          if (find(child))
            return true;
        }
        return false;
      }
      const found = find(renderer.root);
      if (!found)
        return;
      focus.focus();
    }, 1);
  }
  Keymap.createLayer(() => ({
    mode: "modal",
    enabled: store.stack.length > 0,
    commands: [{
      bind: "escape",
      title: "Close dialog",
      group: "Dialog",
      run: () => {
        if (renderer.getSelection()) {
          renderer.clearSelection();
          return;
        }
        const current = store.stack.at(-1);
        current?.onClose?.();
        setStore("stack", store.stack.slice(0, -1));
        refocus();
      }
    }, {
      bind: "ctrl+c",
      title: "Close dialog",
      group: "Dialog",
      run: () => {
        if (renderer.getSelection()) {
          renderer.clearSelection();
          return;
        }
        const editor = renderer.currentFocusedEditor;
        if (editor?.plainText) {
          if (editor instanceof InputRenderable2)
            editor.value = "";
          else
            editor.setText("");
          return;
        }
        const current = store.stack.at(-1);
        current?.onClose?.();
        setStore("stack", store.stack.slice(0, -1));
        refocus();
      }
    }]
  }));
  return {
    clear() {
      for (const item of store.stack) {
        if (item.onClose)
          item.onClose();
      }
      batch2(() => {
        setStore("size", "medium");
        setStore("centered", false);
        setStore("stack", []);
      });
      refocus();
    },
    replace(input, onClose, options) {
      if (store.stack.length === 0) {
        focus = renderer.currentFocusedRenderable;
        focus?.blur();
      }
      for (const item of store.stack) {
        if (item.onClose)
          item.onClose();
      }
      batch2(() => {
        setStore("size", options?.size ?? "medium");
        setStore("centered", false);
        setStore("stack", [{
          element: input,
          onClose,
          key: options?.key
        }]);
      });
    },
    get stack() {
      return store.stack;
    },
    get size() {
      return store.size;
    },
    get centered() {
      return store.centered;
    },
    get key() {
      return store.stack.at(-1)?.key;
    },
    setSize(size) {
      setStore("size", size);
    },
    setCentered(centered) {
      setStore("centered", centered);
    }
  };
}
var ctx2 = createContext9();
function DialogProvider(props) {
  const value = init2();
  const renderer = useRenderer6();
  const toast = useToast();
  const clipboard = useClipboard();
  const config = useConfig();
  const copyOnSelectEnabled = () => (config.data.terminal?.copy ?? (process.platform === "win32" ? "manual" : "select")) === "select";
  return _$createComponent11(ctx2.Provider, {
    value,
    get children() {
      return [_$memo3(() => props.children), (() => {
        var _el$17 = _$createElement4("box");
        _$setProp4(_el$17, "position", "absolute");
        _$setProp4(_el$17, "zIndex", 3000);
        _$setProp4(_el$17, "onMouseDown", (evt) => {
          if (copyOnSelectEnabled())
            return;
          if (evt.button !== MouseButton.RIGHT)
            return;
          if (!copy2(renderer, toast, clipboard))
            return;
          evt.preventDefault();
          evt.stopPropagation();
        });
        _$insert4(_el$17, _$createComponent11(Show5, {
          get when() {
            return value.stack.length;
          },
          get children() {
            return _$createComponent11(Dialog, {
              onClose: () => value.clear(),
              get size() {
                return value.size;
              },
              get centered() {
                return value.centered;
              },
              get children() {
                return _$createComponent11(Show5, {
                  get when() {
                    return value.stack.at(-1);
                  },
                  keyed: true,
                  children: (item) => item.element()
                });
              }
            });
          }
        }));
        _$effect4((_$p) => _$setProp4(_el$17, "onMouseUp", copyOnSelectEnabled() ? (event) => copyOnSelectRelease(event, renderer, toast, clipboard) : undefined, _$p));
        return _el$17;
      })()];
    }
  });
}
function useDialog() {
  const value = useContext10(ctx2);
  if (!value) {
    throw new Error("useDialog must be used within a DialogProvider");
  }
  return value;
}

// ../tui-base/src/ui/dialog-confirm.tsx
import { createStore as createStore7 } from "solid-js/store";
import { For as For3 } from "solid-js";

// ../../node_modules/.pnpm/ansi-regex@6.4.0/node_modules/ansi-regex/index.js
function ansiRegex({ onlyFirst = false } = {}) {
  const ST = "(?:\\u0007|\\u001B\\u005C|\\u009C)";
  const osc = `(?:(?:\\u001B\\]|\\u009D)[^\\u0007\\u001B\\u009C\\u009D]*${ST})`;
  const csi = "[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]";
  const pattern = `${osc}|${csi}`;
  return new RegExp(pattern, onlyFirst ? undefined : "g");
}

// ../../node_modules/.pnpm/strip-ansi@7.1.2/node_modules/strip-ansi/index.js
var regex = ansiRegex();
function stripAnsi(string) {
  if (typeof string !== "string") {
    throw new TypeError(`Expected a \`string\`, got \`${typeof string}\``);
  }
  return string.replace(regex, "");
}

// ../../node_modules/.pnpm/get-east-asian-width@1.6.0/node_modules/get-east-asian-width/lookup-data.js
var ambiguousMinimalCodePoint = 161;
var ambiguousMaximumCodePoint = 1114109;
var ambiguousRanges = [161, 161, 164, 164, 167, 168, 170, 170, 173, 174, 176, 180, 182, 186, 188, 191, 198, 198, 208, 208, 215, 216, 222, 225, 230, 230, 232, 234, 236, 237, 240, 240, 242, 243, 247, 250, 252, 252, 254, 254, 257, 257, 273, 273, 275, 275, 283, 283, 294, 295, 299, 299, 305, 307, 312, 312, 319, 322, 324, 324, 328, 331, 333, 333, 338, 339, 358, 359, 363, 363, 462, 462, 464, 464, 466, 466, 468, 468, 470, 470, 472, 472, 474, 474, 476, 476, 593, 593, 609, 609, 708, 708, 711, 711, 713, 715, 717, 717, 720, 720, 728, 731, 733, 733, 735, 735, 768, 879, 913, 929, 931, 937, 945, 961, 963, 969, 1025, 1025, 1040, 1103, 1105, 1105, 8208, 8208, 8211, 8214, 8216, 8217, 8220, 8221, 8224, 8226, 8228, 8231, 8240, 8240, 8242, 8243, 8245, 8245, 8251, 8251, 8254, 8254, 8308, 8308, 8319, 8319, 8321, 8324, 8364, 8364, 8451, 8451, 8453, 8453, 8457, 8457, 8467, 8467, 8470, 8470, 8481, 8482, 8486, 8486, 8491, 8491, 8531, 8532, 8539, 8542, 8544, 8555, 8560, 8569, 8585, 8585, 8592, 8601, 8632, 8633, 8658, 8658, 8660, 8660, 8679, 8679, 8704, 8704, 8706, 8707, 8711, 8712, 8715, 8715, 8719, 8719, 8721, 8721, 8725, 8725, 8730, 8730, 8733, 8736, 8739, 8739, 8741, 8741, 8743, 8748, 8750, 8750, 8756, 8759, 8764, 8765, 8776, 8776, 8780, 8780, 8786, 8786, 8800, 8801, 8804, 8807, 8810, 8811, 8814, 8815, 8834, 8835, 8838, 8839, 8853, 8853, 8857, 8857, 8869, 8869, 8895, 8895, 8978, 8978, 9312, 9449, 9451, 9547, 9552, 9587, 9600, 9615, 9618, 9621, 9632, 9633, 9635, 9641, 9650, 9651, 9654, 9655, 9660, 9661, 9664, 9665, 9670, 9672, 9675, 9675, 9678, 9681, 9698, 9701, 9711, 9711, 9733, 9734, 9737, 9737, 9742, 9743, 9756, 9756, 9758, 9758, 9792, 9792, 9794, 9794, 9824, 9825, 9827, 9829, 9831, 9834, 9836, 9837, 9839, 9839, 9886, 9887, 9919, 9919, 9926, 9933, 9935, 9939, 9941, 9953, 9955, 9955, 9960, 9961, 9963, 9969, 9972, 9972, 9974, 9977, 9979, 9980, 9982, 9983, 10045, 10045, 10102, 10111, 11094, 11097, 12872, 12879, 57344, 63743, 65024, 65039, 65533, 65533, 127232, 127242, 127248, 127277, 127280, 127337, 127344, 127373, 127375, 127376, 127387, 127404, 917760, 917999, 983040, 1048573, 1048576, 1114109];
var fullwidthMinimalCodePoint = 12288;
var fullwidthMaximumCodePoint = 65510;
var fullwidthRanges = [12288, 12288, 65281, 65376, 65504, 65510];
var wideMinimalCodePoint = 4352;
var wideMaximumCodePoint = 262141;
var wideRanges = [4352, 4447, 8986, 8987, 9001, 9002, 9193, 9196, 9200, 9200, 9203, 9203, 9725, 9726, 9748, 9749, 9776, 9783, 9800, 9811, 9855, 9855, 9866, 9871, 9875, 9875, 9889, 9889, 9898, 9899, 9917, 9918, 9924, 9925, 9934, 9934, 9940, 9940, 9962, 9962, 9970, 9971, 9973, 9973, 9978, 9978, 9981, 9981, 9989, 9989, 9994, 9995, 10024, 10024, 10060, 10060, 10062, 10062, 10067, 10069, 10071, 10071, 10133, 10135, 10160, 10160, 10175, 10175, 11035, 11036, 11088, 11088, 11093, 11093, 11904, 11929, 11931, 12019, 12032, 12245, 12272, 12287, 12289, 12350, 12353, 12438, 12441, 12543, 12549, 12591, 12593, 12686, 12688, 12773, 12783, 12830, 12832, 12871, 12880, 42124, 42128, 42182, 43360, 43388, 44032, 55203, 63744, 64255, 65040, 65049, 65072, 65106, 65108, 65126, 65128, 65131, 94176, 94180, 94192, 94198, 94208, 101589, 101631, 101662, 101760, 101874, 110576, 110579, 110581, 110587, 110589, 110590, 110592, 110882, 110898, 110898, 110928, 110930, 110933, 110933, 110948, 110951, 110960, 111355, 119552, 119638, 119648, 119670, 126980, 126980, 127183, 127183, 127374, 127374, 127377, 127386, 127488, 127490, 127504, 127547, 127552, 127560, 127568, 127569, 127584, 127589, 127744, 127776, 127789, 127797, 127799, 127868, 127870, 127891, 127904, 127946, 127951, 127955, 127968, 127984, 127988, 127988, 127992, 128062, 128064, 128064, 128066, 128252, 128255, 128317, 128331, 128334, 128336, 128359, 128378, 128378, 128405, 128406, 128420, 128420, 128507, 128591, 128640, 128709, 128716, 128716, 128720, 128722, 128725, 128728, 128732, 128735, 128747, 128748, 128756, 128764, 128992, 129003, 129008, 129008, 129292, 129338, 129340, 129349, 129351, 129535, 129648, 129660, 129664, 129674, 129678, 129734, 129736, 129736, 129741, 129756, 129759, 129770, 129775, 129784, 131072, 196605, 196608, 262141];

// ../../node_modules/.pnpm/get-east-asian-width@1.6.0/node_modules/get-east-asian-width/utilities.js
var isInRange = (ranges, codePoint) => {
  let low = 0;
  let high = Math.floor(ranges.length / 2) - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const i = mid * 2;
    if (codePoint < ranges[i]) {
      high = mid - 1;
    } else if (codePoint > ranges[i + 1]) {
      low = mid + 1;
    } else {
      return true;
    }
  }
  return false;
};

// ../../node_modules/.pnpm/get-east-asian-width@1.6.0/node_modules/get-east-asian-width/lookup.js
var commonCjkCodePoint = 19968;
var [wideFastPathStart, wideFastPathEnd] = /* @__PURE__ */ findWideFastPathRange(wideRanges);
function findWideFastPathRange(ranges) {
  let fastPathStart = ranges[0];
  let fastPathEnd = ranges[1];
  for (let index = 0;index < ranges.length; index += 2) {
    const start = ranges[index];
    const end = ranges[index + 1];
    if (commonCjkCodePoint >= start && commonCjkCodePoint <= end) {
      return [start, end];
    }
    if (end - start > fastPathEnd - fastPathStart) {
      fastPathStart = start;
      fastPathEnd = end;
    }
  }
  return [fastPathStart, fastPathEnd];
}
var isAmbiguous = (codePoint) => {
  if (codePoint < ambiguousMinimalCodePoint || codePoint > ambiguousMaximumCodePoint) {
    return false;
  }
  return isInRange(ambiguousRanges, codePoint);
};
var isFullWidth = (codePoint) => {
  if (codePoint < fullwidthMinimalCodePoint || codePoint > fullwidthMaximumCodePoint) {
    return false;
  }
  return isInRange(fullwidthRanges, codePoint);
};
var isWide = (codePoint) => {
  if (codePoint >= wideFastPathStart && codePoint <= wideFastPathEnd) {
    return true;
  }
  if (codePoint < wideMinimalCodePoint || codePoint > wideMaximumCodePoint) {
    return false;
  }
  return isInRange(wideRanges, codePoint);
};

// ../../node_modules/.pnpm/get-east-asian-width@1.6.0/node_modules/get-east-asian-width/index.js
function validate2(codePoint) {
  if (!Number.isSafeInteger(codePoint)) {
    throw new TypeError(`Expected a code point, got \`${typeof codePoint}\`.`);
  }
}
function eastAsianWidth(codePoint, { ambiguousAsWide = false } = {}) {
  validate2(codePoint);
  if (isFullWidth(codePoint) || isWide(codePoint) || ambiguousAsWide && isAmbiguous(codePoint)) {
    return 2;
  }
  return 1;
}

// ../../node_modules/.pnpm/string-width@7.2.0/node_modules/string-width/index.js
var import_emoji_regex = __toESM(require_emoji_regex(), 1);
var segmenter = new Intl.Segmenter;
var defaultIgnorableCodePointRegex = /^\p{Default_Ignorable_Code_Point}$/u;
function stringWidth(string, options = {}) {
  if (typeof string !== "string" || string.length === 0) {
    return 0;
  }
  const {
    ambiguousIsNarrow = true,
    countAnsiEscapeCodes = false
  } = options;
  if (!countAnsiEscapeCodes) {
    string = stripAnsi(string);
  }
  if (string.length === 0) {
    return 0;
  }
  let width = 0;
  const eastAsianWidthOptions = { ambiguousAsWide: !ambiguousIsNarrow };
  for (const { segment: character } of segmenter.segment(string)) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 31 || codePoint >= 127 && codePoint <= 159) {
      continue;
    }
    if (codePoint >= 8203 && codePoint <= 8207 || codePoint === 65279) {
      continue;
    }
    if (codePoint >= 768 && codePoint <= 879 || codePoint >= 6832 && codePoint <= 6911 || codePoint >= 7616 && codePoint <= 7679 || codePoint >= 8400 && codePoint <= 8447 || codePoint >= 65056 && codePoint <= 65071) {
      continue;
    }
    if (codePoint >= 55296 && codePoint <= 57343) {
      continue;
    }
    if (codePoint >= 65024 && codePoint <= 65039) {
      continue;
    }
    if (defaultIgnorableCodePointRegex.test(character)) {
      continue;
    }
    if (import_emoji_regex.default().test(character)) {
      width += 2;
      continue;
    }
    width += eastAsianWidth(codePoint, eastAsianWidthOptions);
  }
  return width;
}

// ../tui-base/src/util/string-width.node.ts
var graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
var textEmoji = /^\p{Emoji}\p{Mark}*$/u;
var emojiPresentation = /^\p{Emoji_Presentation}/u;
function stringWidth2(value) {
  return Array.from(graphemes.segment(stripAnsi(value))).reduce((total, part) => {
    const width = stringWidth(part.segment);
    const codePoint = part.segment.codePointAt(0);
    if (width !== 2 || codePoint === undefined || eastAsianWidth(codePoint) === 2 || !textEmoji.test(part.segment) || emojiPresentation.test(part.segment) || part.segment.includes("️") || part.segment.includes("⃣") || part.segment.includes("‍"))
      return total + width;
    return total + 1;
  }, 0);
}
// ../tui-base/src/util/locale.ts
function titlecase(str) {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}
function truncate(str, len) {
  if (str.length <= len)
    return str;
  return str.slice(0, len - 1) + "…";
}
var graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function truncateLeft(str, len) {
  if (str.length <= len)
    return str;
  return "…" + str.slice(-(len - 1));
}
function truncateMiddle(str, maxLength = 35) {
  if (maxLength <= 0)
    return "";
  if (str.length <= maxLength)
    return str;
  const ellipsis = "…";
  const keepStart = Math.ceil((maxLength - ellipsis.length) / 2);
  const keepEnd = Math.floor((maxLength - ellipsis.length) / 2);
  if (keepEnd <= 0)
    return str.slice(0, keepStart) + ellipsis;
  return str.slice(0, keepStart) + ellipsis + str.slice(-keepEnd);
}

// ../tui-base/src/ui/dialog-confirm.tsx
function DialogConfirm(props) {
  const dialog = useDialog();
  const theme = useTheme().surface("dialog");
  const newDesigns = useNewDesigns();
  const [store, setStore] = createStore7({
    active: "confirm"
  });
  const choose = (key) => {
    if (key === "confirm")
      props.onConfirm?.();
    if (key === "cancel")
      props.onCancel?.();
    dialog.clear();
  };
  Keymap.createLayer(() => ({
    mode: "modal",
    commands: newDesigns() ? [{
      bind: "return",
      title: "Confirm",
      group: "Dialog",
      run: () => choose("confirm")
    }, {
      bind: "escape",
      title: "Cancel",
      group: "Dialog",
      run: () => choose("cancel")
    }] : [{
      bind: "return",
      title: "Confirm dialog selection",
      group: "Dialog",
      run: () => choose(store.active)
    }, {
      bind: "left",
      title: "Previous dialog option",
      group: "Dialog",
      run: () => {
        setStore("active", store.active === "confirm" ? "cancel" : "confirm");
      }
    }, {
      bind: "right",
      title: "Next dialog option",
      group: "Dialog",
      run: () => {
        setStore("active", store.active === "confirm" ? "cancel" : "confirm");
      }
    }]
  }));
  return _$createComponent12(DialogLayout, {
    get header() {
      return _$createComponent12(DialogHeader, {
        get title() {
          return props.title;
        }
      });
    },
    get footer() {
      return {
        actions: {
          primary: [
            {
              title: (props.label?.cancel ?? "cancel").toLowerCase(),
              key: "esc",
              onTrigger: () => choose("cancel")
            },
            {
              title: (props.label?.confirm ?? "confirm").toLowerCase(),
              key: "enter",
              onTrigger: () => choose("confirm")
            }
          ]
        }
      };
    },
    get legacyFooter() {
      return (() => {
        var _el$2 = _$createElement5("box");
        _$setProp5(_el$2, "flexDirection", "row");
        _$setProp5(_el$2, "justifyContent", "flex-end");
        _$insert5(_el$2, _$createComponent12(For3, {
          each: ["cancel", "confirm"],
          children: (key) => (() => {
            var _el$3 = _$createElement5("box"), _el$4 = _$createElement5("text");
            _$insertNode5(_el$3, _el$4);
            _$setProp5(_el$3, "paddingLeft", 1);
            _$setProp5(_el$3, "paddingRight", 1);
            _$setProp5(_el$3, "onMouseUp", () => choose(key));
            _$insert5(_el$4, () => titlecase(props.label?.[key] ?? key));
            _$effect5((_p$) => {
              var _v$ = key === store.active ? theme.background.action.primary.focused : undefined, _v$2 = key === store.active ? theme.text.action.primary.focused : theme.text.muted;
              _v$ !== _p$.e && (_p$.e = _$setProp5(_el$3, "backgroundColor", _v$, _p$.e));
              _v$2 !== _p$.t && (_p$.t = _$setProp5(_el$4, "fg", _v$2, _p$.t));
              return _p$;
            }, {
              e: undefined,
              t: undefined
            });
            return _el$3;
          })()
        }));
        return _el$2;
      })();
    },
    get children() {
      var _el$ = _$createElement5("text");
      _$insert5(_el$, () => props.message);
      _$effect5((_$p) => _$setProp5(_el$, "fg", theme.text.muted, _$p));
      return _el$;
    }
  });
}

// ../tui-base/src/ui/dialog-select.tsx
import { memo as _$memo4 } from "@opentui/solid";
import { createTextNode as _$createTextNode4 } from "@opentui/solid";
import { insertNode as _$insertNode6 } from "@opentui/solid";
import { insert as _$insert6 } from "@opentui/solid";
import { createComponent as _$createComponent13 } from "@opentui/solid";
import { effect as _$effect6 } from "@opentui/solid";
import { use as _$use3 } from "@opentui/solid";
import { setProp as _$setProp6 } from "@opentui/solid";
import { createElement as _$createElement6 } from "@opentui/solid";
import { CliRenderEvents as CliRenderEvents2, RGBA as RGBA8, TextAttributes as TextAttributes3 } from "@opentui/core";
// ../../node_modules/.pnpm/remeda@2.26.0/node_modules/remeda/dist/chunk-D6FCK2GA.js
function u(o, n, a) {
  let t = (r) => o(r, ...n);
  return a === undefined ? t : Object.assign(t, { lazy: a, lazyArgs: n });
}

// ../../node_modules/.pnpm/remeda@2.26.0/node_modules/remeda/dist/chunk-WIMGWYZL.js
function u2(r, n, o) {
  let a = r.length - n.length;
  if (a === 0)
    return r(...n);
  if (a === 1)
    return u(r, n, o);
  throw new Error("Wrong number of arguments");
}

// ../../node_modules/.pnpm/remeda@2.26.0/node_modules/remeda/dist/chunk-HVPVHFDT.js
function i(...e) {
  return u2(p, e);
}
var p = (e, d) => {
  let r = Object.create(null);
  for (let n = 0;n < e.length; n++) {
    let t = e[n], y = d(t, n, e);
    if (y !== undefined) {
      let o = r[y];
      o === undefined ? r[y] = [t] : o.push(t);
    }
  }
  return Object.setPrototypeOf(r, Object.prototype), r;
};
// ../../node_modules/.pnpm/remeda@2.26.0/node_modules/remeda/dist/chunk-HGKLN5KY.js
function k(...n) {
  return u2(u3, n);
}
function u3(n, e) {
  if (n === e || Object.is(n, e))
    return true;
  if (typeof n != "object" || typeof e != "object" || n === null || e === null || Object.getPrototypeOf(n) !== Object.getPrototypeOf(e))
    return false;
  if (Array.isArray(n))
    return l(n, e);
  if (n instanceof Map)
    return a(n, e);
  if (n instanceof Set)
    return c(n, e);
  if (n instanceof Date)
    return n.getTime() === e.getTime();
  if (n instanceof RegExp)
    return n.toString() === e.toString();
  if (Object.keys(n).length !== Object.keys(e).length)
    return false;
  for (let [r, t] of Object.entries(n))
    if (!(r in e) || !u3(t, e[r]))
      return false;
  return true;
}
function l(n, e) {
  if (n.length !== e.length)
    return false;
  for (let [r, t] of n.entries())
    if (!u3(t, e[r]))
      return false;
  return true;
}
function a(n, e) {
  if (n.size !== e.size)
    return false;
  for (let [r, t] of n.entries())
    if (!e.has(r) || !u3(t, e.get(r)))
      return false;
  return true;
}
function c(n, e) {
  if (n.size !== e.size)
    return false;
  let r = [...e];
  for (let t of n) {
    let o = false;
    for (let [s, f] of r.entries())
      if (u3(t, f)) {
        o = true, r.splice(s, 1);
        break;
      }
    if (!o)
      return false;
  }
  return true;
}
// ../../node_modules/.pnpm/remeda@2.26.0/node_modules/remeda/dist/chunk-FRNNS7AX.js
function u4(...a) {
  return u2(o, a, l2);
}
var o = (a, r) => a.flatMap(r);
var l2 = (a) => (r, t, y) => {
  let n = a(r, t, y);
  return Array.isArray(n) ? { done: false, hasNext: true, hasMany: true, next: n } : { done: false, hasNext: true, next: n };
};
// ../../node_modules/.pnpm/remeda@2.26.0/node_modules/remeda/dist/chunk-VVM5DH6Z.js
function t(...r) {
  return u2(Object.entries, r);
}
// ../../node_modules/.pnpm/remeda@2.26.0/node_modules/remeda/dist/chunk-ANXBDSUI.js
var s = { done: false, hasNext: false };

// ../../node_modules/.pnpm/remeda@2.26.0/node_modules/remeda/dist/chunk-7U7TOHLV.js
function m(...e) {
  return u2(o2, e, i2);
}
var o2 = (e, n) => e.filter(n);
var i2 = (e) => (n, a, d) => e(n, a, d) ? { done: false, hasNext: true, next: n } : s;
// ../../node_modules/.pnpm/remeda@2.26.0/node_modules/remeda/dist/chunk-3GOCSNFN.js
function C(t, ...o) {
  let n = t, u = o.map((e) => ("lazy" in e) ? y(e) : undefined), p = 0;
  for (;p < o.length; ) {
    if (u[p] === undefined || !B(n)) {
      let i = o[p];
      n = i(n), p += 1;
      continue;
    }
    let r = [];
    for (let i = p;i < o.length; i++) {
      let l = u[i];
      if (l === undefined || (r.push(l), l.isSingle))
        break;
    }
    let a = [];
    for (let i of n)
      if (f(i, a, r))
        break;
    let { isSingle: s } = r.at(-1);
    n = s ? a[0] : a, p += r.length;
  }
  return n;
}
function f(t, o, n) {
  if (n.length === 0)
    return o.push(t), false;
  let u = t, p = s, e = false;
  for (let [r, a] of n.entries()) {
    let { index: s, items: i } = a;
    if (i.push(u), p = a(u, s, i), a.index += 1, p.hasNext) {
      if (p.hasMany ?? false) {
        for (let l of p.next)
          if (f(l, o, n.slice(r + 1)))
            return true;
        return e;
      }
      u = p.next;
    }
    if (!p.hasNext)
      break;
    p.done && (e = true);
  }
  return p.hasNext && o.push(u), e;
}
function y(t) {
  let { lazy: o, lazyArgs: n } = t, u = o(...n);
  return Object.assign(u, { isSingle: o.single ?? false, index: 0, items: [] });
}
function B(t) {
  return typeof t == "string" || typeof t == "object" && t !== null && Symbol.iterator in t;
}
// ../tui-base/src/ui/dialog-select.tsx
var fuzzysort = __toESM(require_fuzzysort(), 1);
import { batch as batch3, createEffect as createEffect3, createMemo as createMemo5, createSignal as createSignal9, For as For4, Show as Show6, on, onCleanup as onCleanup10, onMount as onMount3 } from "solid-js";
import { createStore as createStore8 } from "solid-js/store";
import { useRenderer as useRenderer7, useTerminalDimensions as useTerminalDimensions3 } from "@opentui/solid";

// ../tui-base/src/util/scroll.ts
import { MacOSScrollAccel } from "@opentui/core";

class CustomSpeedScroll {
  speed;
  constructor(speed) {
    this.speed = speed;
  }
  tick(_now) {
    return this.speed;
  }
  reset() {}
}
function getScrollAcceleration(config) {
  if (config?.scroll?.acceleration) {
    return new MacOSScrollAccel;
  }
  if (config?.scroll?.speed !== undefined) {
    return new CustomSpeedScroll(config.scroll.speed);
  }
  return new CustomSpeedScroll(3);
}

// ../tui-base/src/ui/select-controller.ts
function reconcileSelection(selected, count) {
  return Math.max(0, Math.min(count - 1, selected));
}
function moveSelection(selected, input) {
  if (input.count <= 0)
    return 0;
  const next = selected + input.delta;
  if (input.policy === "clamp")
    return reconcileSelection(next, input.count);
  if (next < 0)
    return input.count - 1;
  if (next >= input.count)
    return 0;
  return next;
}

// ../tui-base/src/ui/dialog-select.tsx
function dialogSelectContentWidth(dialogWidth) {
  return dialogWidth - DIALOG_LIST_INSET * 2 - 4;
}
function DialogSelect(props) {
  const dialog = useDialog();
  const theme = useTheme().surface("dialog");
  const config = useConfig().data;
  const cursorStyle = useCursorStyle();
  const newDesigns = useNewDesigns();
  const scrollAcceleration = createMemo5(() => getScrollAcceleration(config));
  const renderer = useRenderer7();
  const [store, setStore] = createStore8({
    selected: 0,
    filter: ""
  });
  let selection;
  let resetSelection = false;
  let pendingScroll;
  function scrollAfterLayout(center, value) {
    if (pendingScroll)
      renderer.off(CliRenderEvents2.FRAME, pendingScroll);
    pendingScroll = () => {
      pendingScroll = undefined;
      if (!k(selected()?.value, value))
        return;
      scrollToSelection(center);
    };
    renderer.once(CliRenderEvents2.FRAME, pendingScroll);
    renderer.requestRender();
  }
  createEffect3(on([() => props.focusTarget ?? props.current, () => props.focusTarget === undefined ? undefined : flat()], ([current]) => {
    if (props.search || props.focusCurrent === false)
      return;
    if (props.focusTarget !== undefined && (props.preserveSelection || store.filter.length > 0))
      return;
    if (current !== undefined) {
      const currentIndex = flat().findIndex((opt) => k(opt.value, current));
      if (currentIndex >= 0) {
        setStore("selected", currentIndex);
        selection = flat()[currentIndex];
        scrollAfterLayout(true, current);
      }
    }
  }));
  let input;
  const actions = createMemo5(() => props.actions ?? []);
  const shownActions = createMemo5(() => actions().filter((item) => !item.hidden));
  const shortcuts = Keymap.useShortcuts();
  const actionLabels = createMemo5(() => {
    const labels = new Map;
    for (const action of shownActions()) {
      const label = shortcuts.all(action.command);
      if (label)
        labels.set(action.command, label);
    }
    return labels;
  });
  const visibleActions = createMemo5(() => [...shownActions().map((item) => ({
    ...item,
    label: actionLabels().get(item.command) ?? ""
  })).filter((item) => item.label), ...props.footerHints ?? []]);
  const filtered = createMemo5(() => {
    if (props.search)
      return props.search(store.filter).filter((x) => x.disabled !== true);
    if (props.skipFilter || props.renderFilter === false)
      return props.options.filter((x) => x.disabled !== true);
    const needle = store.filter.toLowerCase();
    const options = C(props.options, m((x) => x.disabled !== true));
    if (!needle)
      return options;
    const result = fuzzysort.go(needle, options, {
      keys: ["title", "category", "searchText"],
      scoreFn: (r) => r[0].score * 2 + r[1].score + r[2].score,
      threshold: props.filterThreshold
    }).map((x) => x.obj);
    return result;
  });
  const flatten = createMemo5(() => props.search !== undefined || props.flat && store.filter.length > 0);
  const grouped = createMemo5(() => {
    if (flatten())
      return filtered().length ? [["", filtered()]] : [];
    const result = C(filtered(), i((x) => x.category ?? ""), t());
    return result;
  });
  const flat = createMemo5(() => {
    return C(grouped(), u4(([_, options]) => options));
  });
  const rows = createMemo5(() => {
    const headers = grouped().reduce((acc, [category], i) => {
      if (!category)
        return acc;
      return acc + (i > 0 ? 2 : 1);
    }, 0);
    return flat().reduce((acc, option) => acc + 1 + (option.details?.length ?? 0), headers);
  });
  const dimensions = useTerminalDimensions3();
  const limit = createMemo5(() => Math.floor(dimensions().height / 2) - 6);
  const overflows = createMemo5(() => newDesigns() && rows() > limit());
  const detailsWidth = createMemo5(() => dialogSelectContentWidth(Math.min(dialogWidth(dialog.size), dimensions().width)));
  const [moreBelow, setMoreBelow] = createSignal9(false);
  const ellipsis = () => overflows() && moreBelow();
  const height = createMemo5(() => Math.min(rows(), limit()) - (ellipsis() ? 1 : 0));
  function updateMoreBelow() {
    if (!scroll || scroll.isDestroyed)
      return;
    setMoreBelow(scroll.scrollTop + scroll.viewport.height < scroll.scrollHeight);
  }
  const selected = createMemo5(() => flat()[store.selected]);
  const detailView = () => {
    const detail = selected()?.detail;
    return typeof detail === "function" ? detail : undefined;
  };
  const detailText = () => {
    const detail = selected()?.detail;
    return typeof detail === "string" ? detail : undefined;
  };
  createEffect3(on(() => props.options, () => {
    if (props.search)
      return;
    if (!props.preserveSelection && ((props.focusTarget ?? props.current) === undefined || props.focusCurrent === false)) {
      const count = flat().length;
      if (count === 0)
        return;
      const next = reconcileSelection(store.selected, count);
      if (next !== store.selected)
        setStore("selected", next);
      return;
    }
    if (resetSelection && store.filter.length > 0) {
      const option = flat()[0];
      if (!option)
        return;
      setStore("selected", 0);
      selection = option;
      return;
    }
    if (!selection) {
      if (props.focusCurrent !== false && (props.focusTarget ?? props.current) !== undefined) {
        const index = flat().findIndex((option) => k(option.value, props.focusTarget ?? props.current));
        if (index >= 0) {
          setStore("selected", index);
          selection = flat()[index];
          return;
        }
      }
      const option = selected();
      if (!option)
        return;
      selection = option;
      return;
    }
    const previous = selection;
    const index = flat().findIndex((option) => k(option.value, previous.value));
    if (index >= 0) {
      const option = flat()[index];
      const moved = index !== store.selected || option.category !== previous.category;
      setStore("selected", index);
      selection = option;
      if (!moved)
        return;
      if (!props.preserveSelection && ((props.focusTarget ?? props.current) === undefined || props.focusCurrent === false || store.filter.length > 0))
        return;
      scrollAfterLayout(false, option.value);
      return;
    }
    const next = reconcileSelection(store.selected, flat().length);
    if (flat().length === 0)
      return;
    setStore("selected", next);
    selection = flat()[next];
  }));
  createEffect3(on([flat, () => store.filter, () => props.focusCurrent === false ? undefined : props.focusTarget ?? props.current], ([options, query, current], previous) => {
    if (!props.search)
      return;
    const queryChanged = previous !== undefined && query !== previous[1];
    const currentChanged = current !== undefined && (previous === undefined || !k(current, previous[2]));
    selection = intent();
    const intended = selection;
    const index = intended ? options.findIndex((option) => k(option.value, intended.value)) : -1;
    const next = index >= 0 ? index : reconcileSelection(store.selected, options.length);
    const option = options[next];
    if (!option)
      return;
    setStore("selected", next);
    selection = option;
    scrollAfterLayout(queryChanged || currentChanged, option.value);
    function intent() {
      if (queryChanged && query)
        return options[0];
      if ((queryChanged || currentChanged) && current !== undefined)
        return {
          value: current
        };
      if (queryChanged)
        return options[reconcileSelection(store.selected, options.length)];
      return selection;
    }
  }));
  onCleanup10(() => {
    if (!pendingScroll)
      return;
    renderer.off(CliRenderEvents2.FRAME, pendingScroll);
    pendingScroll = undefined;
  });
  createEffect3(on([() => store.filter, () => props.focusTarget ?? props.current], ([filter, current]) => {
    if (props.search)
      return;
    if (filter.length > 0)
      resetSelection = true;
    if (filter.length > 0) {
      const option = flat()[0];
      if (!option)
        return;
      moveTo(0, true, false);
      scrollAfterLayout(true, option.value);
      return;
    }
    if (current === undefined || props.focusCurrent === false)
      return;
    const currentIndex = flat().findIndex((opt) => k(opt.value, current));
    if (currentIndex < 0)
      return;
    moveTo(currentIndex, true);
    scrollAfterLayout(true, current);
  }));
  function move(direction) {
    if (props.locked)
      return;
    if (flat().length === 0)
      return;
    moveTo(moveSelection(store.selected, {
      count: flat().length,
      delta: direction,
      policy: "wrap"
    }), true);
  }
  function moveSection(direction) {
    if (props.locked)
      return;
    const sections = grouped().filter(([_, options]) => options.length > 0);
    if (sections.length === 0)
      return;
    const current = sections.findIndex(([category]) => category === selected()?.category);
    const section = sections[(current + direction + sections.length) % sections.length];
    moveTo(flat().indexOf(section[1][0]), true);
  }
  function moveTo(next, center = false, preserve = true) {
    setStore("selected", next);
    const option = selected();
    if (option) {
      selection = option;
      resetSelection = !preserve;
    }
    if (option)
      props.onMove?.(option);
    scrollToSelection(center);
  }
  function scrollToSelection(center) {
    if (!scroll)
      return;
    let remaining = store.selected;
    let index = 0;
    for (const [category, options] of grouped()) {
      if (category)
        index++;
      if (remaining < options.length) {
        index += remaining;
        break;
      }
      index += options.length;
      remaining -= options.length;
    }
    const target = scroll.getChildren()[index];
    if (!target)
      return;
    const y = target.y - scroll.y;
    if (center) {
      const centerOffset = Math.floor(scroll.height / 2);
      scroll.scrollBy(y - centerOffset);
    } else {
      if (y >= scroll.height) {
        scroll.scrollBy(y - scroll.height + 1);
      }
      if (y < 0) {
        scroll.scrollBy(y);
        if (k(flat()[0].value, selected()?.value)) {
          scroll.scrollTo(0);
        }
      }
    }
  }
  function submit() {
    if (props.locked)
      return;
    const option = selected();
    if (!option)
      return;
    option.onSelect?.(dialog);
    props.onSelect?.(option);
  }
  Keymap.createLayer(() => {
    const visible = shownActions();
    return {
      mode: "modal",
      commands: [{
        id: "dialog.select.prev",
        title: "Previous item",
        group: "Dialog",
        run() {
          move(-1);
        }
      }, {
        id: "dialog.select.next",
        title: "Next item",
        group: "Dialog",
        run() {
          move(1);
        }
      }, {
        id: "dialog.select.page_up",
        title: "Page up",
        group: "Dialog",
        run() {
          move(-10);
        }
      }, {
        id: "dialog.select.page_down",
        title: "Page down",
        group: "Dialog",
        run() {
          move(10);
        }
      }, {
        id: "dialog.select.home",
        title: "First item",
        group: "Dialog",
        run() {
          if (props.locked)
            return;
          moveTo(0);
        }
      }, {
        id: "dialog.select.end",
        title: "Last item",
        group: "Dialog",
        run() {
          if (props.locked)
            return;
          moveTo(flat().length - 1);
        }
      }, {
        id: "dialog.select.submit",
        title: "Select item",
        group: "Dialog",
        run: submit
      }, ...visible.map((item) => ({
        id: item.command,
        title: typeof item.title === "function" ? item.title(undefined) : item.title,
        group: "Dialog",
        bind: item.bind,
        run: () => trigger(item)
      })), ...props.bindings ?? [], ...props.onCancel ? [{
        bind: "escape",
        title: "Back",
        group: "Dialog",
        run: () => {
          if (renderer.getSelection()) {
            renderer.clearSelection();
            return;
          }
          props.onCancel?.();
        }
      }] : [], ...props.sectionNavigation ? [{
        bind: "alt+up",
        title: "Previous section",
        group: "Dialog",
        run: () => moveSection(-1)
      }, {
        bind: "alt+down",
        title: "Next section",
        group: "Dialog",
        run: () => moveSection(1)
      }] : []]
    };
  });
  let scroll;
  const ref = {
    get filter() {
      return store.filter;
    },
    get filtered() {
      return filtered();
    },
    get selected() {
      return selected();
    },
    setFilter(value) {
      if (input) {
        input.value = value;
        return;
      }
      if (value === store.filter)
        return;
      batch3(() => {
        setStore("filter", value);
        props.onFilter?.(value);
      });
    },
    moveTo(value) {
      const index = flat().findIndex((option) => k(option.value, value));
      if (index >= 0)
        moveTo(index, true);
    }
  };
  onMount3(() => props.ref?.(ref));
  const footerActions = createMemo5(() => visibleActions().map((item) => {
    if (!isActionItem(item))
      return {
        side: item.side,
        group: item.group ?? "secondary",
        action: {
          title: item.title,
          key: item.label
        }
      };
    return {
      side: item.side,
      group: item.group ?? (item.selection === "none" ? "secondary" : "primary"),
      action: {
        title: actionTitle(item),
        key: item.label,
        disabled: isActionDisabled(item),
        onTrigger: () => trigger(item)
      }
    };
  }));
  const footerGroup = (match) => footerActions().filter(match).map((item) => item.action);
  function trigger(item) {
    if (props.locked || !item || isActionDisabled(item))
      return;
    if (item.selection === "none") {
      item.onTrigger();
      return;
    }
    const option = selected();
    if (!option)
      return;
    item.onTrigger(option);
  }
  function actionTitle(item) {
    return typeof item.title === "function" ? item.title(selected()) : item.title;
  }
  function isActionItem(item) {
    return "onTrigger" in item;
  }
  function isActionDisabled(item) {
    const option = selected();
    if (item.selection !== "none" && !option)
      return true;
    return typeof item.disabled === "function" ? item.disabled(option) : item.disabled;
  }
  const searchInTitle = () => newDesigns() && props.searchInTitle === true && props.renderFilter !== false;
  const searchCursorColor = () => {
    if (!newDesigns())
      return theme.text.formfield.focused;
    return store.filter.length > 0 ? theme.text.base : theme.background.action.primary.focused;
  };
  const searchInput = () => (() => {
    var _el$ = _$createElement6("input");
    _$use3((r) => {
      input = r;
      input.traits = {
        status: "FILTER"
      };
      setTimeout(() => {
        if (!input)
          return;
        if (r.isDestroyed)
          return;
        r.focus();
      }, 1);
    }, _el$);
    _$setProp6(_el$, "flexGrow", 1);
    _$setProp6(_el$, "onInput", (e) => {
      if (props.locked)
        return;
      batch3(() => {
        setStore("filter", e);
        props.onFilter?.(e);
      });
    });
    _$effect6((_p$) => {
      var _v$ = theme.background.formfield.focused, _v$2 = searchCursorColor(), _v$3 = cursorStyle(), _v$4 = newDesigns() ? theme.text.formfield.base : theme.text.formfield.focused, _v$5 = (searchInTitle() ? props.titlePlaceholder : undefined) ?? props.placeholder ?? "Search", _v$6 = theme.text.muted;
      _v$ !== _p$.e && (_p$.e = _$setProp6(_el$, "focusedBackgroundColor", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp6(_el$, "cursorColor", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp6(_el$, "cursorStyle", _v$3, _p$.a));
      _v$4 !== _p$.o && (_p$.o = _$setProp6(_el$, "focusedTextColor", _v$4, _p$.o));
      _v$5 !== _p$.i && (_p$.i = _$setProp6(_el$, "placeholder", _v$5, _p$.i));
      _v$6 !== _p$.n && (_p$.n = _$setProp6(_el$, "placeholderColor", _v$6, _p$.n));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined
    });
    return _el$;
  })();
  return _$createComponent13(DialogLayout, {
    get footerGap() {
      return props.footerGap;
    },
    get header() {
      return (() => {
        var _el$7 = _$createElement6("box");
        _$setProp6(_el$7, "paddingLeft", DIALOG_LIST_INSET - DIALOG_INSET);
        _$setProp6(_el$7, "paddingRight", DIALOG_LIST_INSET - DIALOG_INSET);
        _$insert6(_el$7, _$createComponent13(Show6, {
          get when() {
            return searchInTitle();
          },
          get fallback() {
            return [_$createComponent13(DialogHeader, {
              get title() {
                return props.title;
              },
              get titleView() {
                return props.titleView;
              },
              get description() {
                return props.description;
              },
              get onClose() {
                return props.onCancel;
              }
            }), _$createComponent13(Show6, {
              get when() {
                return props.renderFilter !== false;
              },
              get children() {
                var _el$8 = _$createElement6("box");
                _$setProp6(_el$8, "paddingTop", 1);
                _$insert6(_el$8, searchInput);
                return _el$8;
              }
            })];
          },
          get children() {
            return _$createComponent13(DialogHeader, {
              get titleView() {
                return searchInput();
              },
              gap: 2,
              get onClose() {
                return props.onCancel;
              }
            });
          }
        }));
        return _el$7;
      })();
    },
    get footer() {
      return {
        inset: DIALOG_LIST_INSET - DIALOG_INSET,
        actions: {
          secondary: footerGroup((item) => item.group === "secondary"),
          primary: footerGroup((item) => item.group === "primary")
        },
        get children() {
          return props.footer;
        }
      };
    },
    get legacyFooter() {
      return _$createComponent13(Show6, {
        get when() {
          return props.footer || visibleActions().length;
        },
        get fallback() {
          return (() => {
            var _el$9 = _$createElement6("box");
            _$setProp6(_el$9, "flexShrink", 0);
            return _el$9;
          })();
        },
        get children() {
          return _$createComponent13(DialogFooter, {
            inset: DIALOG_LIST_INSET - DIALOG_INSET,
            get actions() {
              return {
                secondary: footerGroup((item) => item.side !== "right"),
                primary: footerGroup((item) => item.side === "right")
              };
            },
            get children() {
              return props.footer;
            }
          });
        }
      });
    },
    get children() {
      return _$createComponent13(DialogBleed, {
        get children() {
          return _$createComponent13(Show6, {
            get when() {
              return grouped().length > 0;
            },
            get fallback() {
              return _$createComponent13(Show6, {
                get when() {
                  return _$memo4(() => props.renderFilter !== false)() && store.filter.length > 0;
                },
                get fallback() {
                  return props.emptyView ?? (() => {
                    var _el$0 = _$createElement6("box"), _el$1 = _$createElement6("text");
                    _$insertNode6(_el$0, _el$1);
                    _$setProp6(_el$0, "paddingLeft", DIALOG_LIST_INSET);
                    _$setProp6(_el$0, "paddingRight", DIALOG_LIST_INSET);
                    _$insertNode6(_el$1, _$createTextNode4(`No items available`));
                    _$effect6((_$p) => _$setProp6(_el$1, "fg", theme.text.muted, _$p));
                    return _el$0;
                  })();
                },
                get children() {
                  return props.noMatchView ?? (() => {
                    var _el$11 = _$createElement6("box"), _el$12 = _$createElement6("text");
                    _$insertNode6(_el$11, _el$12);
                    _$setProp6(_el$11, "paddingLeft", DIALOG_LIST_INSET);
                    _$setProp6(_el$11, "paddingRight", DIALOG_LIST_INSET);
                    _$insertNode6(_el$12, _$createTextNode4(`No results found`));
                    _$effect6((_$p) => _$setProp6(_el$12, "fg", theme.text.muted, _$p));
                    return _el$11;
                  })();
                }
              });
            },
            get children() {
              return [(() => {
                var _el$2 = _$createElement6("scrollbox");
                _$use3((r) => {
                  scroll = r;
                  r.verticalScrollBar.on("change", updateMoreBelow);
                  r.content.on("resize", updateMoreBelow);
                  r.viewport.on("resize", updateMoreBelow);
                }, _el$2);
                _$setProp6(_el$2, "scrollbarOptions", {
                  visible: false
                });
                _$insert6(_el$2, _$createComponent13(For4, {
                  get each() {
                    return grouped();
                  },
                  children: ([category, options], index) => [_$createComponent13(Show6, {
                    when: category,
                    get children() {
                      return _$createComponent13(DialogSelectCategory, {
                        title: category,
                        get first() {
                          return index() === 0;
                        }
                      });
                    }
                  }), _$createComponent13(For4, {
                    each: options,
                    children: (option) => {
                      const active = createMemo5(() => !props.locked && k(option.value, selected()?.value));
                      const current = createMemo5(() => k(option.value, props.current));
                      return (() => {
                        var _el$14 = _$createElement6("box");
                        _$setProp6(_el$14, "flexDirection", "column");
                        _$setProp6(_el$14, "position", "relative");
                        _$setProp6(_el$14, "onMouseMove", () => {
                          if (props.locked)
                            return;
                          const index = flat().findIndex((x) => k(x.value, option.value));
                          if (index === -1 || index === store.selected)
                            return;
                          moveTo(index);
                        });
                        _$setProp6(_el$14, "onMouseUp", () => {
                          if (props.locked)
                            return;
                          option.onSelect?.(dialog);
                          props.onSelect?.(option);
                        });
                        _$setProp6(_el$14, "onMouseDown", () => {
                          if (props.locked)
                            return;
                          const index = flat().findIndex((x) => k(x.value, option.value));
                          if (index === -1)
                            return;
                          moveTo(index);
                        });
                        _$insert6(_el$14, _$createComponent13(DialogSelectRow, {
                          get title() {
                            return option.title;
                          },
                          get titleView() {
                            return option.titleView;
                          },
                          get footer() {
                            return _$memo4(() => !!flatten())() ? option.searchFooter ?? option.category ?? option.footer : option.footer;
                          },
                          get footerColor() {
                            return option.footerColor;
                          },
                          get footerOverhang() {
                            return option.footerOverhang;
                          },
                          get titleWidth() {
                            return option.titleWidth;
                          },
                          get truncateTitle() {
                            return option.truncateTitle;
                          },
                          get description() {
                            return _$memo4(() => option.description !== category)() ? option.description : undefined;
                          },
                          get active() {
                            return active();
                          },
                          get current() {
                            return current();
                          },
                          get activeBackground() {
                            return option.bg;
                          },
                          get activeColor() {
                            return option.fg;
                          },
                          get gutter() {
                            return option.gutter;
                          },
                          get margin() {
                            return option.margin;
                          }
                        }), null);
                        _$insert6(_el$14, _$createComponent13(DialogSelectDetails, {
                          get details() {
                            return option.details;
                          },
                          get width() {
                            return detailsWidth();
                          }
                        }), null);
                        return _el$14;
                      })();
                    }
                  })]
                }));
                _$effect6((_p$) => {
                  var _v$7 = newDesigns() ? 0 : 1, _v$8 = newDesigns() ? 0 : 1, _v$9 = scrollAcceleration(), _v$0 = height();
                  _v$7 !== _p$.e && (_p$.e = _$setProp6(_el$2, "paddingLeft", _v$7, _p$.e));
                  _v$8 !== _p$.t && (_p$.t = _$setProp6(_el$2, "paddingRight", _v$8, _p$.t));
                  _v$9 !== _p$.a && (_p$.a = _$setProp6(_el$2, "scrollAcceleration", _v$9, _p$.a));
                  _v$0 !== _p$.o && (_p$.o = _$setProp6(_el$2, "maxHeight", _v$0, _p$.o));
                  return _p$;
                }, {
                  e: undefined,
                  t: undefined,
                  a: undefined,
                  o: undefined
                });
                return _el$2;
              })(), _$createComponent13(Show6, {
                get when() {
                  return ellipsis();
                },
                get children() {
                  var _el$3 = _$createElement6("box"), _el$4 = _$createElement6("text");
                  _$insertNode6(_el$3, _el$4);
                  _$setProp6(_el$3, "paddingLeft", DIALOG_LIST_INSET);
                  _$setProp6(_el$3, "flexShrink", 0);
                  _$insertNode6(_el$4, _$createTextNode4(`…`));
                  _$effect6((_$p) => _$setProp6(_el$4, "fg", theme.text.muted, _$p));
                  return _el$3;
                }
              }), _$createComponent13(Show6, {
                get when() {
                  return _$memo4(() => !!newDesigns())() && flat().some((option) => option.detail !== undefined);
                },
                get children() {
                  var _el$6 = _$createElement6("box");
                  _$setProp6(_el$6, "paddingTop", 1);
                  _$setProp6(_el$6, "paddingLeft", DIALOG_LIST_INSET);
                  _$setProp6(_el$6, "paddingRight", DIALOG_LIST_INSET);
                  _$setProp6(_el$6, "flexShrink", 0);
                  _$insert6(_el$6, _$createComponent13(Show6, {
                    get when() {
                      return detailView();
                    },
                    keyed: true,
                    get fallback() {
                      return (() => {
                        var _el$15 = _$createElement6("text");
                        _$setProp6(_el$15, "wrapMode", "word");
                        _$insert6(_el$15, () => detailText() || " ");
                        _$effect6((_$p) => _$setProp6(_el$15, "fg", theme.surface("dialog.footer").text.muted, _$p));
                        return _el$15;
                      })();
                    },
                    children: (render) => render()
                  }));
                  return _el$6;
                }
              })];
            }
          });
        }
      });
    }
  });
}
function DialogSelectCategory(props) {
  const theme = useTheme().surface("dialog");
  const newDesigns = useNewDesigns();
  return (() => {
    var _el$17 = _$createElement6("box"), _el$18 = _$createElement6("text");
    _$insertNode6(_el$17, _el$18);
    _$insert6(_el$18, () => props.title);
    _$effect6((_p$) => {
      var _v$1 = props.first ? 0 : 1, _v$10 = DIALOG_LIST_INSET - (newDesigns() ? 0 : 1), _v$11 = newDesigns() ? theme.text.muted : theme.hue.accent[200], _v$12 = TextAttributes3.BOLD;
      _v$1 !== _p$.e && (_p$.e = _$setProp6(_el$17, "paddingTop", _v$1, _p$.e));
      _v$10 !== _p$.t && (_p$.t = _$setProp6(_el$17, "paddingLeft", _v$10, _p$.t));
      _v$11 !== _p$.a && (_p$.a = _$setProp6(_el$18, "fg", _v$11, _p$.a));
      _v$12 !== _p$.o && (_p$.o = _$setProp6(_el$18, "attributes", _v$12, _p$.o));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined
    });
    return _el$17;
  })();
}
function DialogSelectRow(props) {
  const theme = useTheme().surface("dialog");
  const newDesigns = useNewDesigns();
  const text = createMemo5(() => {
    if (props.active)
      return props.activeColor ?? theme.text.action.primary.focused;
    if (props.current && !newDesigns())
      return theme.text.formfield.selected;
    return theme.text.base;
  });
  const secondary = () => {
    if (!newDesigns())
      return props.active ? text() : theme.text.muted;
    return props.active ? theme.text.action.secondary.focused : theme.text.muted;
  };
  const row = () => (() => {
    var _el$19 = _$createElement6("box"), _el$23 = _$createElement6("text");
    _$insertNode6(_el$19, _el$23);
    _$setProp6(_el$19, "flexDirection", "row");
    _$setProp6(_el$19, "gap", 1);
    _$insert6(_el$19, _$createComponent13(Show6, {
      get when() {
        return _$memo4(() => !!!props.current)() && props.margin;
      },
      get children() {
        var _el$20 = _$createElement6("box");
        _$setProp6(_el$20, "position", "absolute");
        _$setProp6(_el$20, "left", DIALOG_LIST_INSET - 3);
        _$setProp6(_el$20, "flexShrink", 0);
        _$insert6(_el$20, () => props.margin);
        return _el$20;
      }
    }), _el$23);
    _$insert6(_el$19, _$createComponent13(Show6, {
      get when() {
        return _$memo4(() => !!props.current)() && !props.gutter;
      },
      get children() {
        var _el$21 = _$createElement6("text");
        _$setProp6(_el$21, "flexShrink", 0);
        _$insert6(_el$21, () => newDesigns() ? "▪" : "●");
        _$effect6((_$p) => _$setProp6(_el$21, "fg", newDesigns() ? theme.text.formfield.selected : text(), _$p));
        return _el$21;
      }
    }), _el$23);
    _$insert6(_el$19, _$createComponent13(Show6, {
      get when() {
        return props.gutter;
      },
      get children() {
        var _el$22 = _$createElement6("box");
        _$setProp6(_el$22, "flexShrink", 0);
        _$insert6(_el$22, () => props.gutter?.(text()));
        return _el$22;
      }
    }), _el$23);
    _$setProp6(_el$23, "flexGrow", 1);
    _$setProp6(_el$23, "overflow", "hidden");
    _$setProp6(_el$23, "wrapMode", "none");
    _$setProp6(_el$23, "paddingLeft", 3);
    _$insert6(_el$23, () => props.titleView ?? (props.truncateTitle === false ? props.title : props.truncateTitle === "left" ? truncateLeft(props.title, props.titleWidth ?? 61) : truncate(props.title, props.titleWidth ?? 61)), null);
    _$insert6(_el$23, _$createComponent13(Show6, {
      get when() {
        return props.description;
      },
      get children() {
        var _el$24 = _$createElement6("span");
        _$insert6(_el$24, () => " " + props.description);
        _$effect6((_$p) => _$setProp6(_el$24, "style", {
          fg: secondary()
        }, _$p));
        return _el$24;
      }
    }), null);
    _$insert6(_el$19, _$createComponent13(Show6, {
      get when() {
        return props.footer;
      },
      get children() {
        var _el$25 = _$createElement6("box"), _el$26 = _$createElement6("text");
        _$insertNode6(_el$25, _el$26);
        _$setProp6(_el$25, "flexShrink", 0);
        _$insert6(_el$26, () => props.footer);
        _$effect6((_p$) => {
          var _v$13 = props.footerOverhang ? -props.footerOverhang : undefined, _v$14 = props.active || !props.footerColor ? secondary() : props.footerColor;
          _v$13 !== _p$.e && (_p$.e = _$setProp6(_el$25, "marginRight", _v$13, _p$.e));
          _v$14 !== _p$.t && (_p$.t = _$setProp6(_el$26, "fg", _v$14, _p$.t));
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        return _el$25;
      }
    }), null);
    _$effect6((_p$) => {
      var _v$15 = newDesigns() ? 1 : undefined, _v$16 = props.current || props.gutter ? DIALOG_LIST_INSET - 3 : DIALOG_LIST_INSET - 1, _v$17 = DIALOG_LIST_INSET - (newDesigns() ? 0 : 1), _v$18 = props.active ? props.activeBackground ?? theme.background.action.primary.focused : RGBA8.fromInts(0, 0, 0, 0), _v$19 = text(), _v$20 = props.active && !newDesigns() ? TextAttributes3.BOLD : undefined;
      _v$15 !== _p$.e && (_p$.e = _$setProp6(_el$19, "flexGrow", _v$15, _p$.e));
      _v$16 !== _p$.t && (_p$.t = _$setProp6(_el$19, "paddingLeft", _v$16, _p$.t));
      _v$17 !== _p$.a && (_p$.a = _$setProp6(_el$19, "paddingRight", _v$17, _p$.a));
      _v$18 !== _p$.o && (_p$.o = _$setProp6(_el$19, "backgroundColor", _v$18, _p$.o));
      _v$19 !== _p$.i && (_p$.i = _$setProp6(_el$23, "fg", _v$19, _p$.i));
      _v$20 !== _p$.n && (_p$.n = _$setProp6(_el$23, "attributes", _v$20, _p$.n));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined
    });
    return _el$19;
  })();
  return _$createComponent13(Show6, {
    get when() {
      return newDesigns();
    },
    get fallback() {
      return row();
    },
    get children() {
      var _el$27 = _$createElement6("box"), _el$28 = _$createElement6("text");
      _$insertNode6(_el$27, _el$28);
      _$setProp6(_el$27, "flexDirection", "row");
      _$setProp6(_el$28, "width", 1);
      _$setProp6(_el$28, "flexShrink", 0);
      _$insert6(_el$28, () => props.active ? "┃" : " ");
      _$insert6(_el$27, row, null);
      _$effect6((_$p) => _$setProp6(_el$28, "fg", theme.text.formfield.focused, _$p));
      return _el$27;
    }
  });
}
function DialogSelectDetails(props) {
  const theme = useTheme().surface("dialog");
  const newDesigns = useNewDesigns();
  return _$createComponent13(For4, {
    get each() {
      return props.details;
    },
    children: (detail) => (() => {
      var _el$29 = _$createElement6("box"), _el$30 = _$createElement6("text");
      _$insertNode6(_el$29, _el$30);
      _$setProp6(_el$30, "wrapMode", "none");
      _$insert6(_el$30, () => truncateMiddle(detail, Math.max(1, props.width)));
      _$effect6((_p$) => {
        var _v$21 = DIALOG_LIST_INSET - (newDesigns() ? 0 : 1), _v$22 = DIALOG_LIST_INSET - (newDesigns() ? 0 : 1), _v$23 = theme.text.muted;
        _v$21 !== _p$.e && (_p$.e = _$setProp6(_el$29, "paddingLeft", _v$21, _p$.e));
        _v$22 !== _p$.t && (_p$.t = _$setProp6(_el$29, "paddingRight", _v$22, _p$.t));
        _v$23 !== _p$.a && (_p$.a = _$setProp6(_el$30, "fg", _v$23, _p$.a));
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined
      });
      return _el$29;
    })()
  });
}

// ../tui-base/src/routes/session/turn-overlays.tsx
function summarizeArgs(name, args, limit = 160) {
  let body = JSON.stringify(args);
  if (body === undefined)
    body = "";
  body = body.trim();
  if (body.length > limit)
    body = body.slice(0, limit - 1) + "…";
  return `${name} ${body}`.trim();
}
function ApprovalCard(props) {
  return _$createComponent14(DialogConfirm, {
    get title() {
      return `Approval: ${props.name}`;
    },
    get message() {
      return summarizeArgs(props.name, props.args);
    },
    label: {
      confirm: "allow",
      cancel: "reject"
    },
    onConfirm: () => props.onVerdict("allowed-once"),
    onCancel: () => props.onVerdict("rejected")
  });
}
function askTabStrip(questions, picks, index) {
  return questions.map((_, qi) => {
    const answered = (picks[qi]?.length ?? 0) > 0;
    const label = `${qi + 1}${answered ? "✓" : ""}`;
    return qi === index ? `[${label}]` : label;
  }).join(" · ");
}
function askProgressTitle(questions, index) {
  if (questions.length < 2)
    return "Question";
  return `Question (${index + 1}/${questions.length})`;
}
function askNeedsReview(questions) {
  return questions.length >= 2 || questions.some((question) => question.multiSelect === true);
}
function truncate70(text) {
  return text.length > 70 ? text.slice(0, 69) + "…" : text;
}
function AskPicker(props) {
  const [version, setVersion] = createSignal10(0);
  onMount4(() => {
    const unsubscribe = props.controller.subscribe(() => setVersion((v) => v + 1));
    onCleanup11(unsubscribe);
  });
  const ask = () => {
    version();
    return props.controller.pendingAsk;
  };
  return _$createComponent14(Show7, {
    get when() {
      return ask()?.phase === "review";
    },
    get fallback() {
      return _$createComponent14(AskQuestionsView, {
        ask,
        get controller() {
          return props.controller;
        },
        get onDecline() {
          return props.onDecline;
        }
      });
    },
    get children() {
      return _$createComponent14(AskReviewView, {
        ask,
        get controller() {
          return props.controller;
        },
        get onDecline() {
          return props.onDecline;
        }
      });
    }
  });
}
function AskQuestionsView(props) {
  const batch = () => props.ask();
  const question = () => {
    const b = batch();
    return b?.questions[b.index];
  };
  const multi = () => question()?.multiSelect === true;
  const picked = () => {
    const b = batch();
    return b?.picks[b.index] ?? [];
  };
  const options = () => {
    const q = question();
    const p = picked();
    if (!q)
      return [];
    const rows = q.options.map((option) => ({
      title: multi() ? p.includes(option) ? `[x] ${option}` : `[ ] ${option}` : option,
      value: option
    }));
    if (askNeedsReview(batch()?.questions ?? []))
      rows.push({
        title: "⏎ Review answers",
        value: {
          kind: "review"
        }
      });
    return rows;
  };
  const description = () => {
    const b = batch();
    if (!b)
      return;
    const parts = [];
    if (b.questions.length >= 2)
      parts.push(askTabStrip(b.questions, b.picks, b.index));
    if (multi())
      parts.push("space: toggle");
    return parts.join("  ·  ") || undefined;
  };
  const toggleHighlighted = () => {
    const option = selectRefRef?.selected;
    if (option && typeof option.value === "string")
      props.controller.toggle(option.value);
  };
  const bindings = () => {
    const b = batch();
    return [...b && b.questions.length >= 2 ? [{
      id: "ask.prev_question",
      title: "Previous question",
      group: "Dialog",
      bind: "left",
      run: () => props.controller.switchFocus(-1)
    }, {
      id: "ask.next_question",
      title: "Next question",
      group: "Dialog",
      bind: "right",
      run: () => props.controller.switchFocus(1)
    }] : [], {
      id: "ask.toggle",
      title: "Toggle option",
      group: "Dialog",
      bind: "space",
      run: toggleHighlighted
    }];
  };
  const title = () => {
    const b = batch();
    const q = question();
    if (!b || !q)
      return "";
    return `${askProgressTitle(b.questions, b.index)}: ${truncate70(q.prompt)}`;
  };
  let selectRefRef;
  return _$createComponent14(DialogSelect, {
    get title() {
      return title();
    },
    get description() {
      return description();
    },
    renderFilter: false,
    get options() {
      return options();
    },
    get current() {
      return _$memo5(() => !!multi())() ? undefined : picked()[0];
    },
    ref: (r) => selectRefRef = r,
    get bindings() {
      return bindings();
    },
    onSelect: (option) => {
      if (typeof option.value === "string")
        props.controller.toggle(option.value);
      else
        props.controller.enterReview();
    },
    get onCancel() {
      return props.onDecline;
    }
  });
}
function AskReviewView(props) {
  const options = () => {
    const b = props.ask();
    if (!b)
      return [];
    const rows = b.questions.map((question, qi) => {
      const picks = b.picks[qi] ?? [];
      return {
        title: `${truncate70(question.prompt)}  ${picks.length > 0 ? picks.join(", ") : "—"}`,
        value: {
          kind: "question",
          qi
        }
      };
    });
    rows.push({
      title: "⏎ Submit answers",
      value: {
        kind: "submit"
      }
    });
    return rows;
  };
  return _$createComponent14(DialogSelect, {
    title: "Review answers",
    description: "←: edit · enter: submit",
    renderFilter: false,
    get options() {
      return options();
    },
    bindings: [{
      id: "ask.back_to_questions",
      title: "Edit answers",
      group: "Dialog",
      bind: "left",
      run: () => props.controller.backToQuestions()
    }],
    onSelect: (option) => {
      if (typeof option.value === "string")
        return;
      if (option.value.kind === "submit")
        props.controller.submit();
      else if (option.value.kind === "question")
        props.controller.backToQuestions(option.value.qi);
    },
    get onCancel() {
      return props.onDecline;
    }
  });
}
function TurnOverlayHost(props) {
  const dialog = useDialog();
  const [version, setVersion] = createSignal10(0);
  onMount4(() => {
    const unsubscribe = props.controller.subscribe(() => setVersion((v) => v + 1));
    onCleanup11(unsubscribe);
  });
  props.controller.onIdle(() => {
    setTimeout(() => props.reclaimFocus?.(), 3);
  });
  let shown;
  createEffect4(() => {
    version();
    const approval = props.controller.pendingApproval;
    const ask = props.controller.pendingAsk;
    const key = approval ? `approval:${approval.id}` : ask ? `ask:${ask.id}` : "";
    if (key === shown)
      return;
    shown = key;
    if (approval) {
      const atOpen = key;
      dialog.replace(() => _$createComponent14(ApprovalCard, {
        get name() {
          return approval.name;
        },
        get args() {
          return approval.args;
        },
        onVerdict: (verdict) => {
          if (verdict === "allowed-once")
            props.controller.confirmApproval();
          else
            props.controller.rejectApproval();
        }
      }), () => {
        if (shown === atOpen)
          props.controller.rejectApproval();
      });
      return;
    }
    if (ask) {
      const atOpen = key;
      dialog.replace(() => _$createComponent14(AskPicker, {
        get controller() {
          return props.controller;
        },
        onDecline: () => props.controller.decline()
      }), () => {
        if (shown === atOpen)
          props.controller.decline();
      });
      return;
    }
    if (untrack(() => dialog.stack.length) > 0)
      dialog.clear();
  });
  return _$createComponent14(Show7, {
    when: false,
    children: null
  });
}
function registerTurnOverlays(seam, controller) {
  seam.registerAskProvider((questions) => controller.answer(questions));
}

// ../tui-base/src/routes/session/slash-palette.tsx
import { createTextNode as _$createTextNode5 } from "@opentui/solid";
import { insertNode as _$insertNode7 } from "@opentui/solid";
import { effect as _$effect7 } from "@opentui/solid";
import { insert as _$insert7 } from "@opentui/solid";
import { createComponent as _$createComponent15 } from "@opentui/solid";
import { setProp as _$setProp7 } from "@opentui/solid";
import { createElement as _$createElement7 } from "@opentui/solid";
import { For as For5, Show as Show8, createSignal as createSignal11 } from "solid-js";

// ../tui-base/src/routes/session/hotkeys.ts
function hotkeysHeader() {
  return "Keybinds (defaults — override via profiles/<profile>/keybindings.json)";
}
function hotkeyRows() {
  const rows = [];
  for (const [name, definition] of Object.entries(Definitions)) {
    if (definition.default === "none" || definition.default === false)
      continue;
    const keys = String(definition.default).replaceAll("<leader>", `${LeaderDefault} `);
    rows.push(`${keys} — ${definition.description} (${name})`);
  }
  return rows;
}

// ../tui-base/src/routes/session/session-info.ts
function formatTps(tps) {
  return tps === null || tps === undefined || !(tps > 0) ? "—" : `${Math.round(tps)} tok/s`;
}
function sessionInfoRows(info) {
  const speed = info.lastTurnTps == null && info.sessionAvgTps == null ? "—" : `last ${formatTps(info.lastTurnTps)} · avg ${formatTps(info.sessionAvgTps)}`;
  return [
    { field: "session", value: info.sessionId ?? "—" },
    { field: "model", value: info.model ?? "—" },
    { field: "messages", value: String(info.messageCount) },
    { field: "turns", value: String(info.turnCount) },
    { field: "tokens in/out", value: `${info.tokensIn} / ${info.tokensOut}` },
    { field: "cache read/write", value: `${info.cacheRead} / ${info.cacheWrite}` },
    { field: "speed", value: speed }
  ];
}
function formatSessionInfoPanel(rows) {
  const width = Math.max(...rows.map((row) => row.field.length));
  return rows.map((row) => `${row.field.padEnd(width)}  ${row.value}`);
}

// ../tui-base/src/routes/session/commands.ts
function coreCommands() {
  return [
    {
      name: "/help",
      description: "show available commands",
      run(ctx) {
        for (const command of coreCommands())
          ctx.say(`${command.name} — ${command.description}`);
      }
    },
    {
      name: "/new",
      description: "start a fresh session",
      async run(ctx) {
        ctx.seam.newSession();
        await ctx.reload();
        ctx.say(`new session ${ctx.seam.currentSessionId() ?? "(unnamed)"}`);
      }
    },
    {
      name: "/model",
      description: "switch model (bare opens the picker)",
      async run(ctx, argText) {
        const arg = argText.trim();
        if (arg) {
          const [providerID, modelID] = arg.split("/");
          if (!providerID || !modelID) {
            ctx.say(`usage: /model or /model provider/model (got "${arg}")`);
            return;
          }
          ctx.seam.selectModel(providerID, modelID);
          ctx.say(`model → ${providerID}/${modelID}`);
          return;
        }
        const catalog = await ctx.seam.modelCatalog();
        if (catalog.length === 0) {
          ctx.say("no models in the catalog");
          return;
        }
        const current = await ctx.seam.currentModelSelection();
        const picked = await ctx.pickOne("Select model", catalog.map((model) => ({
          title: `${model.providerID}/${model.modelID}`,
          value: `${model.providerID}/${model.modelID}`,
          description: current?.providerID === model.providerID && current.modelID === model.modelID ? "current" : undefined
        })));
        if (!picked)
          return;
        const [providerID, modelID] = picked.split("/");
        ctx.seam.selectModel(providerID, modelID);
        ctx.say(`model → ${picked}`);
      }
    },
    {
      name: "/quit",
      description: "exit the app",
      run(ctx) {
        ctx.quit();
      }
    },
    {
      name: "/sessions",
      description: "list and resume stored sessions",
      async run(ctx) {
        const sessions = await ctx.seam.listSessions();
        if (sessions.length === 0) {
          ctx.say("no stored sessions");
          return;
        }
        const picked = await ctx.pickOne("Resume session", sessions.map((session) => ({
          title: session.title,
          value: session.id,
          description: session.updatedAt
        })));
        if (!picked)
          return;
        ctx.seam.resumeSession(picked);
        await ctx.reload();
        ctx.say(`resumed ${picked}`);
      }
    },
    {
      name: "/clear",
      description: "clear the transcript",
      run(ctx) {
        ctx.clear();
        ctx.say("transcript cleared");
      }
    },
    {
      name: "/btw",
      description: "side question (bare reopens the last answer)",
      run(ctx, argText) {
        if (!ctx.seam.btwAsk || !ctx.openBtw) {
          ctx.say("/btw unavailable in this session");
          return;
        }
        ctx.openBtw(argText);
      }
    },
    {
      name: "/session",
      description: "show session info (id, model, tokens, speed)",
      async run(ctx) {
        if (!ctx.seam.sessionInfo) {
          ctx.say("/session unavailable in this session");
          return;
        }
        const info = await ctx.seam.sessionInfo();
        if (!info || info.sessionId === null) {
          ctx.say("no active session");
          return;
        }
        for (const line of formatSessionInfoPanel(sessionInfoRows(info)))
          ctx.say(line);
      }
    },
    {
      name: "/plugins",
      description: "list installed plugins",
      run(ctx) {
        if (!ctx.seam.plugins) {
          ctx.say("/plugins unavailable in this session");
          return;
        }
        const plugins = ctx.seam.plugins();
        if (plugins.length === 0) {
          ctx.say("no plugins installed");
          return;
        }
        for (const plugin of plugins)
          ctx.say(`● ${plugin.name}@${plugin.version}`);
      }
    },
    {
      name: "/think",
      description: "set reasoning effort (opens the picker)",
      async run(ctx) {
        const thinking = ctx.seam.thinking;
        if (!thinking) {
          ctx.say("/think unavailable in this session");
          return;
        }
        const efforts = await thinking.efforts();
        if (efforts.length === 0) {
          ctx.say("/think unavailable: the current model exposes no reasoning efforts");
          return;
        }
        const current = await thinking.currentEffort();
        const picked = await ctx.pickOne("Select reasoning effort", efforts.map((effort) => ({
          title: effort.name,
          value: effort.id,
          description: effort.id === current ? "current" : effort.description
        })));
        if (!picked || picked === current)
          return;
        thinking.selectEffort(picked);
        ctx.say(`thinking → ${picked} (next turn)`);
      }
    },
    {
      name: "/hotkeys",
      description: "show keybinds",
      run(ctx) {
        ctx.say(hotkeysHeader());
        for (const row of hotkeyRows())
          ctx.say(row);
      }
    },
    {
      name: "/theme",
      description: "switch theme (opens the picker)",
      async run(ctx) {
        if (!ctx.themes) {
          ctx.say("/theme unavailable in this session");
          return;
        }
        const current = ctx.themes.current();
        const picked = await ctx.pickOne("Select theme", ctx.themes.list().map((name) => ({
          title: name,
          value: name,
          description: name === current ? "current" : undefined
        })));
        if (!picked || picked === current)
          return;
        if (ctx.themes.set(picked))
          ctx.say(`Theme: ${picked} — applied`);
        else
          ctx.say(`unknown theme: ${picked}`);
      }
    }
  ];
}
function filterCommands(commands, query) {
  if (!query.startsWith("/"))
    return [];
  const needle = query.toLowerCase();
  return commands.filter((command) => command.name.toLowerCase().startsWith(needle));
}
function dispatchLine(commands, line) {
  const text = line.trim();
  if (!text.startsWith("/"))
    return { kind: "text" };
  const [head, ...rest] = text.split(/\s+/);
  const needle = head.toLowerCase();
  const match = commands.find((command) => command.name.toLowerCase() === needle) ?? commands.filter((command) => command.name.toLowerCase().startsWith(needle)).sort((a, b) => b.name.length - a.name.length)[0];
  if (!match)
    return { kind: "unknown", name: head };
  return { kind: "command", command: match, argText: rest.join(" ") };
}
function unknownCommandRow(name) {
  return `unknown command: ${name} (try /help)`;
}

// ../tui-base/src/routes/session/slash-palette.tsx
var MAX_ROWS = 6;

class SlashPaletteController {
  #rows = createSignal11(0);
  #selected = createSignal11(0);
  #query = createSignal11("");
  #suppressed = false;
  #lastBuffer = "";
  rows() {
    return this.#rows[0]();
  }
  selected() {
    return this.#selected[0]();
  }
  query() {
    return this.#query[0]();
  }
  sync(buffer, commands) {
    if (buffer !== this.#lastBuffer) {
      this.#lastBuffer = buffer;
      this.#suppressed = false;
    }
    const next = buffer.startsWith("/") && !buffer.includes(" ") ? buffer : "";
    this.#query[1](next);
    if (!next || this.#suppressed) {
      this.#rows[1](0);
      return;
    }
    const count = filterCommands(commands, next).length;
    this.#rows[1](Math.min(MAX_ROWS, count));
    this.#selected[1]((current) => Math.min(current, Math.max(0, count - 1)));
  }
  filtered(commands) {
    return filterCommands(commands, this.#query[0]());
  }
  move(delta, commands) {
    const count = this.filtered(commands).length;
    if (count === 0)
      return;
    const n = this.#selected[0]();
    this.#selected[1]((n + delta + count) % count);
  }
  current(commands) {
    return this.filtered(commands)[this.#selected[0]()];
  }
  close() {
    this.#suppressed = true;
    this.#query[1]("");
    this.#rows[1](0);
  }
  get open() {
    return this.rows() > 0;
  }
}
function SlashPalette(props) {
  const theme = useThemeOptional();
  const color = {
    active: () => theme?.border.base ?? "#7aa2f7",
    base: () => theme?.text.base ?? "#e6e6e6",
    muted: () => theme?.text.muted ?? "#565f89",
    background: () => theme ? theme.decrease(theme.background.raised.base) : "#1a1b26"
  };
  return _$createComponent15(Show8, {
    get when() {
      return props.controller.rows() > 0;
    },
    get children() {
      var _el$ = _$createElement7("box");
      _$setProp7(_el$, "flexShrink", 0);
      _$setProp7(_el$, "width", "100%");
      _$setProp7(_el$, "flexDirection", "column");
      _$setProp7(_el$, "paddingLeft", 2);
      _$insert7(_el$, _$createComponent15(For5, {
        get each() {
          return props.controller.filtered(props.commands);
        },
        children: (command, index) => (() => {
          var _el$2 = _$createElement7("text"), _el$3 = _$createTextNode5(` `), _el$4 = _$createElement7("span");
          _$insertNode7(_el$2, _el$3);
          _$insertNode7(_el$2, _el$4);
          _$setProp7(_el$2, "flexShrink", 0);
          _$insert7(_el$2, () => command.name, _el$3);
          _$insert7(_el$4, () => command.description);
          _$effect7((_p$) => {
            var _v$3 = index() === props.controller.selected() ? color.active() : color.base(), _v$4 = {
              fg: color.muted()
            };
            _v$3 !== _p$.e && (_p$.e = _$setProp7(_el$2, "fg", _v$3, _p$.e));
            _v$4 !== _p$.t && (_p$.t = _$setProp7(_el$4, "style", _v$4, _p$.t));
            return _p$;
          }, {
            e: undefined,
            t: undefined
          });
          return _el$2;
        })()
      }));
      _$effect7((_p$) => {
        var _v$ = props.controller.rows(), _v$2 = color.background();
        _v$ !== _p$.e && (_p$.e = _$setProp7(_el$, "height", _v$, _p$.e));
        _v$2 !== _p$.t && (_p$.t = _$setProp7(_el$, "backgroundColor", _v$2, _p$.t));
        return _p$;
      }, {
        e: undefined,
        t: undefined
      });
      return _el$;
    }
  });
}
function createSlashHost(deps) {
  const commands = deps.commands ?? coreCommands();
  const controller = new SlashPaletteController;
  const ctx = {
    seam: deps.seam,
    say: deps.say,
    clear: deps.clear,
    reload: deps.reload,
    quit: deps.quit,
    pickOne: deps.pickOne,
    ...deps.openBtw ? {
      openBtw: deps.openBtw
    } : {},
    ...deps.themes ? {
      themes: deps.themes
    } : {}
  };
  function run(command, argText) {
    command.run(ctx, argText);
    return true;
  }
  return {
    commands,
    controller,
    slashKeyFilter(event, buffer) {
      controller.sync(buffer, commands);
      if (!controller.open)
        return false;
      if (event.name === "up" || event.name === "down") {
        event.preventDefault();
        controller.move(event.name === "up" ? -1 : 1, commands);
        return true;
      }
      if (event.name === "escape") {
        event.preventDefault();
        controller.close();
        return true;
      }
      return false;
    },
    interceptSubmit(buffer) {
      controller.sync(buffer, commands);
      const highlighted = controller.current(commands);
      controller.close();
      if (highlighted)
        return run(highlighted, "");
      const dispatch = dispatchLine(commands, buffer);
      if (dispatch.kind === "command")
        return run(dispatch.command, dispatch.argText);
      if (dispatch.kind === "unknown") {
        deps.say(unknownCommandRow(dispatch.name));
        return true;
      }
      return false;
    }
  };
}

// ../tui-base/src/routes/session/btw-overlay.tsx
import { effect as _$effect11 } from "@opentui/solid";
import { insert as _$insert10 } from "@opentui/solid";
import { memo as _$memo8 } from "@opentui/solid";
import { createComponent as _$createComponent18 } from "@opentui/solid";
import { createTextNode as _$createTextNode7 } from "@opentui/solid";
import { insertNode as _$insertNode10 } from "@opentui/solid";
import { setProp as _$setProp11 } from "@opentui/solid";
import { createElement as _$createElement12 } from "@opentui/solid";
import { Show as Show11, createSignal as createSignal14 } from "solid-js";

// ../tui-base/src/ui/dialog-prompt.tsx
import { createTextNode as _$createTextNode6 } from "@opentui/solid";
import { effect as _$effect10 } from "@opentui/solid";
import { insertNode as _$insertNode9 } from "@opentui/solid";
import { insert as _$insert9 } from "@opentui/solid";
import { createComponent as _$createComponent17 } from "@opentui/solid";
import { memo as _$memo7 } from "@opentui/solid";
import { use as _$use4 } from "@opentui/solid";
import { setProp as _$setProp10 } from "@opentui/solid";
import { createElement as _$createElement11 } from "@opentui/solid";
import { Show as Show10, createEffect as createEffect6, createSignal as createSignal13, onMount as onMount5 } from "solid-js";

// ../tui-base/src/component/spinner.tsx
import { insertNode as _$insertNode8 } from "@opentui/solid";
import { setProp as _$setProp9 } from "@opentui/solid";
import { effect as _$effect9 } from "@opentui/solid";
import { insert as _$insert8 } from "@opentui/solid";
import { createElement as _$createElement10 } from "@opentui/solid";
import { createComponent as _$createComponent16 } from "@opentui/solid";
import { memo as _$memo6 } from "@opentui/solid";
import { createEffect as createEffect5, createSignal as createSignal12, onCleanup as onCleanup12, Show as Show9 } from "solid-js";

// ../tui-base/src/component/spinner-renderable.ts
import {
  parseColor,
  Renderable,
  RGBA as RGBA9
} from "@opentui/core";
import { extend } from "@opentui/solid";

// ../tui-base/src/component/spinner-frames.ts
var SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// ../tui-base/src/component/spinner-renderable.ts
var graphemes2 = new Intl.Segmenter(undefined, { granularity: "grapheme" });

class SpinnerRenderable extends Renderable {
  frameTexts = [];
  glyphs = [];
  frameWidth = 0;
  _interval;
  _autoplay;
  _color;
  _backgroundColor;
  index = 0;
  constructor(ctx, options = {}) {
    super(ctx, options);
    this._interval = options.interval ?? 80;
    this._autoplay = options.autoplay ?? true;
    this._color = toColor(options.color ?? RGBA9.defaultForeground());
    this._backgroundColor = parseColor(options.backgroundColor ?? "transparent");
    this.setMeasureProvider(() => ({ width: this.frameWidth, height: 1 }));
    this.frames = options.frames ?? SPINNER_FRAMES;
  }
  set frames(value) {
    if (value.length === this.frameTexts.length && value.every((frame, index) => frame === this.frameTexts[index]))
      return;
    this.frameTexts = value;
    this.glyphs = value.map((frame) => Array.from(graphemes2.segment(frame), (part) => ({ char: part.segment, width: stringWidth2(part.segment) })));
    this.index = 0;
    const width = Math.max(0, ...this.glyphs.map((glyphs) => glyphs.reduce((sum, glyph) => sum + glyph.width, 0)));
    if (width !== this.frameWidth) {
      this.frameWidth = width;
      this.invalidateIntrinsicSize();
    }
    this.restart();
  }
  set interval(value) {
    if (value === this._interval)
      return;
    this._interval = value;
    this.restart();
  }
  set autoplay(value) {
    if (value === this._autoplay)
      return;
    this._autoplay = value;
    this.restart();
  }
  set color(value) {
    this._color = toColor(value);
    this.requestRender();
  }
  set backgroundColor(value) {
    this._backgroundColor = parseColor(value);
    this.requestRender();
  }
  restart() {
    this.animationFps = this._autoplay && this.glyphs.length > 1 ? 1000 / this._interval : undefined;
    this.requestRender();
  }
  onAnimationTick(_deltaTime, ticks) {
    this.index = (this.index + ticks) % this.glyphs.length;
    this.requestRender();
  }
  renderSelf(buffer) {
    const glyphs = this.glyphs[this.index];
    if (!glyphs)
      return;
    let x = this.screenX;
    glyphs.forEach((glyph, char) => {
      const color = typeof this._color === "function" ? parseColor(this._color(this.index, char, this.glyphs.length, glyphs.length)) : this._color;
      buffer.drawText(glyph.char, x, this.screenY, color, this._backgroundColor);
      x += glyph.width;
    });
  }
}
function toColor(value) {
  return typeof value === "function" ? value : parseColor(value);
}
extend({ spinner: SpinnerRenderable });

// ../tui-base/src/component/shimmer-text.tsx
import { spread as _$spread } from "@opentui/solid";
import { mergeProps as _$mergeProps } from "@opentui/solid";
import { createElement as _$createElement9 } from "@opentui/solid";
import { RGBA as RGBA12 } from "@opentui/core";
import { extend as extend3 } from "@opentui/solid";
import { splitProps } from "solid-js";

// ../tui-base/src/component/masked-text.ts
import { OptimizedBuffer, RGBA as RGBA10, TargetChannel, TextRenderable } from "@opentui/core";
var TRANSPARENT = RGBA10.fromValues(0, 0, 0, 0);
var CONTINUATION = 3221225472 | 0;

class MaskedTextRenderable extends TextRenderable {
  matrix = new Float32Array(16);
  scratch;
  mask = new Float32Array(0);
  renderMasked(buffer, initialStrength, shade) {
    if (!this.scratch)
      this.scratch = OptimizedBuffer.create(this.width, this.height, this._ctx.widthMethod, {
        owner: this._ctx.nativeScene,
        respectAlpha: true
      });
    if (this.scratch.width !== this.width || this.scratch.height !== this.height)
      this.scratch.resize(this.width, this.height);
    this.scratch.clear(TRANSPARENT);
    this.drawToBuffer(this.scratch, 0, 0);
    this.scratch.withBuffers((cells) => {
      const characters = cells.char;
      let end = 0;
      for (let row = 0;row < this.height; row++) {
        let column = this.width;
        while (column > 0 && (characters[row * this.width + column - 1] === 32 || characters[row * this.width + column - 1] === 0))
          column--;
        end = Math.max(end, column);
      }
      const intensity = shade(end);
      if (this.mask.length !== this.width * this.height * 3)
        this.mask = new Float32Array(this.width * this.height * 3);
      let strength = initialStrength;
      for (let cell = 0;cell < characters.length; cell++) {
        const column = cell % this.width;
        if ((characters[cell] & CONTINUATION) !== CONTINUATION)
          strength = intensity(column);
        this.mask[cell * 3] = column;
        this.mask[cell * 3 + 1] = Math.floor(cell / this.width);
        this.mask[cell * 3 + 2] = strength;
      }
    });
    this.scratch.colorMatrix(this.matrix, this.mask, 1, TargetChannel.FG);
    buffer.drawFrameBuffer(this.screenX, this.screenY, this.scratch);
  }
  destroySelf() {
    this.scratch?.destroy();
    this.scratch = undefined;
    super.destroySelf();
  }
}

// ../tui-base/src/component/tab-pulse.tsx
import { effect as _$effect8 } from "@opentui/solid";
import { setProp as _$setProp8 } from "@opentui/solid";
import { createElement as _$createElement8 } from "@opentui/solid";
import { Renderable as Renderable2, RGBA as RGBA11 } from "@opentui/core";
import { extend as extend2 } from "@opentui/solid";
var clamp3 = (value) => Math.max(0, Math.min(1, value));
var smootherstep = (value) => value * value * value * (value * (value * 6 - 15) + 10);
var RUN_DURATION = 2800;
var RUN_ATTACK = 450;
var RUN_HEAD = 4;
var RUN_TAIL = 18;
var RUN_FADE_OUT = 500;
var COMPLETION_DURATION = 1200;
var COMPLETION_ATTACK = 0.12;
var COMPLETION_OPACITY = 0.18;
var EDGE_FLASH_DURATION = 800;
var EDGE_FLASH_ATTACK = 0.1;
var EDGE_FLASH_OPACITY = 0.1;
var PROMPT_FLASH_SCALE = 2;
var GLOW_IGNITION_DURATION = 600;
var GLOW_IGNITION_PEAK = 1.5;
var GLOW_IGNITION_ATTACK = 0.3;
var GLOW_FADE_OUT = 200;
var GLOW_RELEASE_DURATION = 900;
var GLOW_RELEASE_ATTACK = 0.12;
var GLOW_RELEASE_PEAK = 1.25;
var GLOW_TAIL = 12;
var GLOW_OPACITY = 0.16;
var DEFAULT_FOREGROUND = RGBA11.defaultForeground();
var PULSE_FPS = 20;
var intensityAt = (index, front, head, tail) => {
  const distance = front - index;
  return distance < 0 ? smootherstep(clamp3(1 + distance / head)) : smootherstep(clamp3(1 - distance / tail));
};
var coast = (value) => {
  const ramp = 0.2;
  if (value < ramp)
    return value * value / (2 * ramp * (1 - ramp));
  if (value > 1 - ramp)
    return 1 - (1 - value) * (1 - value) / (2 * ramp * (1 - ramp));
  return (value - ramp / 2) / (1 - ramp);
};
var fadeOut = (progress) => 1 - smootherstep(progress);
var attackDecay = (progress, attack, peak, rest) => progress < attack ? peak * smootherstep(clamp3(progress / attack)) : peak - (peak - rest) * smootherstep(clamp3((progress - attack) / (1 - attack)));
var completionPulseOpacity = (progress) => attackDecay(progress, COMPLETION_ATTACK, 1, 0);
var glowIgnitionLevel = (progress) => attackDecay(progress, GLOW_IGNITION_ATTACK, GLOW_IGNITION_PEAK, 1);
var glowIntensityAt = (index, tail) => smootherstep(clamp3(1 - Math.max(0, index - 1) / tail));
var tabFlashIntensity = (index, tail) => glowIntensityAt(index, tail);
var glowReleaseSpread = (progress, tail, width) => tail + smootherstep(progress) * width;
var GLOW_RELEASE_DRAIN_FRACTION = GLOW_FADE_OUT / GLOW_RELEASE_DURATION;
var glowReleaseDrain = (progress) => fadeOut(clamp3(progress / GLOW_RELEASE_DRAIN_FRACTION));
var glowReleaseSwell = (progress) => attackDecay(progress, GLOW_RELEASE_ATTACK, GLOW_RELEASE_PEAK, 0);
function blendTabPulseColor(output, background, glowColor, runningColor, flashColor, completionColor, glow, running, flash, completion) {
  if (glow === 0) {
    output.r = background.r;
    output.g = background.g;
    output.b = background.b;
  } else {
    output.r = background.r + (glowColor.r - background.r) * glow;
    output.g = background.g + (glowColor.g - background.g) * glow;
    output.b = background.b + (glowColor.b - background.b) * glow;
  }
  if (running !== 0) {
    output.r += (runningColor.r - output.r) * running;
    output.g += (runningColor.g - output.g) * running;
    output.b += (runningColor.b - output.b) * running;
  }
  if (flash !== 0) {
    output.r += (flashColor.r - output.r) * flash;
    output.g += (flashColor.g - output.g) * flash;
    output.b += (flashColor.b - output.b) * flash;
  }
  if (completion !== 0) {
    output.r += (completionColor.r - output.r) * completion;
    output.g += (completionColor.g - output.g) * completion;
    output.b += (completionColor.b - output.b) * completion;
  }
}

class Envelope {
  scale = 1;
  constructor(duration, shape) {
    this.duration = duration;
    this.shape = shape;
  }
  start(scale = 1) {
    if (this.clock !== undefined)
      return;
    this.clock = 0;
    this.scale = scale;
  }
  restart(scale = 1) {
    this.clock = 0;
    this.scale = scale;
  }
  stop() {
    this.clock = undefined;
  }
  advance(delta) {
    if (this.clock === undefined)
      return;
    this.clock += delta;
    if (this.clock >= this.duration)
      this.clock = undefined;
  }
  get active() {
    return this.clock !== undefined;
  }
  level() {
    return this.clock === undefined ? 0 : this.scale * this.shape(this.clock / this.duration);
  }
}

class GatedEnvelope {
  phaseClock = 0;
  releaseScale = 1;
  constructor(attackStage, releaseStage, initial = "idle") {
    this.attackStage = attackStage;
    this.releaseStage = releaseStage;
    this.phase = initial;
  }
  trigger() {
    this.phase = "attack";
    this.phaseClock = 0;
  }
  release() {
    if (this.phase === "idle")
      return;
    this.releaseScale = this.level;
    this.phase = "release";
    this.phaseClock = 0;
  }
  settle(phase) {
    this.phase = phase;
    this.phaseClock = 0;
  }
  advance(delta) {
    if (this.phase === "idle" || this.phase === "sustain")
      return;
    this.phaseClock += delta;
    const duration = this.phase === "attack" ? this.attackStage.duration : this.releaseStage.duration;
    if (this.phaseClock < duration)
      return;
    this.phase = this.phase === "attack" ? "sustain" : "idle";
    this.phaseClock = 0;
  }
  get level() {
    if (this.phase === "idle")
      return 0;
    if (this.phase === "sustain")
      return 1;
    if (this.phase === "attack")
      return this.attackStage.shape(this.phaseClock / this.attackStage.duration);
    return this.releaseScale * this.releaseStage.shape(this.phaseClock / this.releaseStage.duration);
  }
  get animating() {
    return this.phase === "attack" || this.phase === "release";
  }
  get idle() {
    return this.phase === "idle";
  }
  get releaseProgress() {
    return this.phase === "release" ? this.phaseClock / this.releaseStage.duration : undefined;
  }
  get noteOffLevel() {
    return this.releaseScale;
  }
}

class PulseState {
  completionPending = false;
  sweepClock = 0;
  runEnvelope = new GatedEnvelope({
    duration: RUN_ATTACK,
    shape: smootherstep
  }, {
    duration: RUN_FADE_OUT,
    shape: fadeOut
  });
  completionPulse = new Envelope(COMPLETION_DURATION, completionPulseOpacity);
  edgeFlash = new Envelope(EDGE_FLASH_DURATION, (progress) => attackDecay(progress, EDGE_FLASH_ATTACK, 1, 0));
  constructor(options) {
    this.enabled = options.enabled;
    this.active = options.active;
    this.promptPulse = options.promptPulse;
    this.complete = options.complete;
    this.glow = options.glow;
    this.glowEnvelope = new GatedEnvelope({
      duration: GLOW_IGNITION_DURATION,
      shape: glowIgnitionLevel
    }, {
      duration: GLOW_RELEASE_DURATION,
      shape: glowReleaseDrain
    }, options.glow ? "sustain" : "idle");
    if (this.enabled && this.active)
      this.runEnvelope.trigger();
  }
  get live() {
    return this.enabled && (this.active || this.runEnvelope.animating || this.glowEnvelope.animating || this.completionPulse.active || this.edgeFlash.active);
  }
  get running() {
    return this.runEnvelope.level;
  }
  get completion() {
    return this.completionPulse.level() * COMPLETION_OPACITY;
  }
  get flash() {
    return this.edgeFlash.level() * EDGE_FLASH_OPACITY;
  }
  get glowLevel() {
    return this.glowEnvelope.level;
  }
  get glowReleaseProgress() {
    return this.glowEnvelope.releaseProgress;
  }
  get glowReleaseSwell() {
    const progress = this.glowEnvelope.releaseProgress;
    if (progress === undefined)
      return 0;
    return glowReleaseSwell(progress) * Math.max(1, this.glowEnvelope.noteOffLevel);
  }
  setEnabled(value) {
    if (value === this.enabled)
      return false;
    this.enabled = value;
    if (!value) {
      this.runEnvelope.settle("idle");
      this.glowEnvelope.settle(this.glow ? "sustain" : "idle");
      this.completionPulse.stop();
      this.edgeFlash.stop();
      this.completionPending = false;
    } else if (this.active) {
      this.runEnvelope.trigger();
    }
    return true;
  }
  setActive(value) {
    if (value === this.active)
      return false;
    this.active = value;
    if (!this.enabled)
      return true;
    if (value) {
      this.sweepClock = 0;
      this.runEnvelope.trigger();
      this.completionPulse.stop();
      this.completionPending = false;
    } else {
      this.runEnvelope.release();
      this.completionPending = true;
    }
    this.edgeFlash.start();
    return true;
  }
  setPromptPulse(value) {
    if (value === this.promptPulse)
      return false;
    this.promptPulse = value;
    if (this.enabled)
      this.edgeFlash.restart(PROMPT_FLASH_SCALE);
    return true;
  }
  setComplete(value) {
    if (value === this.complete)
      return false;
    this.complete = value;
    if (!value) {
      this.completionPulse.stop();
      this.completionPending = false;
    }
    if (value && this.completionPending) {
      this.completionPending = false;
      if (this.enabled)
        this.completionPulse.start();
    }
    return true;
  }
  setGlow(value) {
    if (value === this.glow)
      return false;
    this.glow = value;
    if (!this.enabled) {
      this.glowEnvelope.settle(value ? "sustain" : "idle");
      return true;
    }
    if (value)
      this.glowEnvelope.trigger();
    else
      this.glowEnvelope.release();
    return true;
  }
  advance(deltaTime) {
    if (!this.live)
      return;
    if (!this.runEnvelope.idle)
      this.sweepClock += deltaTime;
    this.runEnvelope.advance(deltaTime);
    this.glowEnvelope.advance(deltaTime);
    this.completionPulse.advance(deltaTime);
    this.edgeFlash.advance(deltaTime);
    if (!this.completionPending)
      return;
    if (this.complete) {
      this.completionPending = false;
      this.completionPulse.start();
      return;
    }
    if (this.runEnvelope.releaseProgress === undefined)
      this.completionPending = false;
  }
  sweepFronts = [0, 0];
  fronts(width) {
    const cycles = this.sweepClock / RUN_DURATION;
    const progress = cycles % 1;
    const start = -RUN_HEAD;
    const end = width - 1 + RUN_TAIL;
    const secondProgress = cycles < 0.5 ? 0 : (cycles + 0.5) % 1;
    this.sweepFronts[0] = start + coast(progress) * (end - start);
    this.sweepFronts[1] = start + coast(secondProgress) * (end - start);
    return this.sweepFronts;
  }
}

class TabPulseRenderable extends Renderable2 {
  renderColor = RGBA11.fromInts(0, 0, 0);
  outerRenderColor = RGBA11.fromInts(0, 0, 0);
  lastLevel = 0;
  constructor(ctx, options = {}) {
    const enabled = options.enabled ?? true;
    const active = options.active ?? false;
    const glow = options.glow ?? false;
    const edge = options.edge;
    const outerActive = options.outerActive ?? active;
    const outerGlow = options.outerGlow ?? glow;
    super(ctx, {
      ...options,
      height: 1
    });
    this._enabled = enabled;
    this.inner = new PulseState({
      enabled,
      active,
      promptPulse: options.promptPulse ?? 0,
      complete: options.complete ?? false,
      glow
    });
    this.outer = new PulseState({
      enabled: enabled && edge !== undefined,
      active: outerActive,
      promptPulse: options.outerPromptPulse ?? options.promptPulse ?? 0,
      complete: options.outerComplete ?? options.complete ?? false,
      glow: outerGlow
    });
    this._color = options.color ?? RGBA11.defaultForeground();
    this._outerColor = options.outerColor ?? this._color;
    this._glowColor = options.glowColor ?? this._color;
    this._outerGlowColor = options.outerGlowColor ?? this._glowColor;
    this._glowTail = options.glowTail ?? GLOW_TAIL;
    this._outerGlowTail = options.outerGlowTail ?? this._glowTail;
    this._edge = edge;
    this._flashColor = options.flashColor ?? this._color;
    this._outerFlashColor = options.outerFlashColor ?? options.flashColor ?? this._outerColor;
    this._flashTail = options.flashTail;
    this._outerFlashTail = options.outerFlashTail ?? options.flashTail;
    this._completionColor = options.completionColor ?? this._color;
    this._outerCompletionColor = options.outerCompletionColor ?? options.completionColor ?? this._outerColor;
    this._backgroundColor = options.backgroundColor ?? RGBA11.defaultBackground();
    this._onLevel = options.onLevel;
    this.changed();
  }
  set onLevel(value) {
    this._onLevel = value;
  }
  emitLevel(value) {
    if (!this._onLevel)
      return;
    const quantized = Math.round(value * 32) / 32;
    if (quantized === this.lastLevel)
      return;
    this.lastLevel = quantized;
    this._onLevel?.(quantized);
  }
  set enabled(value) {
    if (value === this._enabled)
      return;
    this._enabled = value;
    this.inner.setEnabled(value);
    this.outer.setEnabled(value && this._edge !== undefined);
    this.changed();
  }
  set active(value) {
    if (this.inner.setActive(value))
      this.changed();
  }
  set outerActive(value) {
    if (this.outer.setActive(value))
      this.changed();
  }
  set promptPulse(value) {
    if (this.inner.setPromptPulse(value))
      this.changed();
  }
  set outerPromptPulse(value) {
    if (this.outer.setPromptPulse(value))
      this.changed();
  }
  set complete(value) {
    if (this.inner.setComplete(value))
      this.changed();
  }
  set outerComplete(value) {
    if (this.outer.setComplete(value))
      this.changed();
  }
  set glow(value) {
    if (this.inner.setGlow(value))
      this.changed();
  }
  set outerGlow(value) {
    if (this.outer.setGlow(value))
      this.changed();
  }
  changed() {
    const animating = this.inner.live || this.outer.live;
    this.animationFps = animating ? PULSE_FPS : undefined;
    this.emitLevel(this.level());
    this.requestRender();
  }
  level() {
    const running = this.inner.running;
    if (running === 0 || this.width <= 0)
      return 0;
    const fronts = this.inner.fronts(this.width);
    return Math.max(intensityAt(1, fronts[0], RUN_HEAD, RUN_TAIL), intensityAt(1, fronts[1], RUN_HEAD, RUN_TAIL)) * running;
  }
  set color(value) {
    if (value.equals(this._color))
      return;
    this._color = value;
    this.requestRender();
  }
  set glowColor(value) {
    if (value.equals(this._glowColor))
      return;
    this._glowColor = value;
    this.requestRender();
  }
  set outerColor(value) {
    if (value.equals(this._outerColor))
      return;
    this._outerColor = value;
    this.requestRender();
  }
  set outerGlowColor(value) {
    if (value.equals(this._outerGlowColor))
      return;
    this._outerGlowColor = value;
    this.requestRender();
  }
  set glowTail(value) {
    if (value === this._glowTail)
      return;
    this._glowTail = value;
    this.requestRender();
  }
  set outerGlowTail(value) {
    if (value === this._outerGlowTail)
      return;
    this._outerGlowTail = value;
    this.requestRender();
  }
  set edge(value) {
    if (value === this._edge)
      return;
    this._edge = value;
    this.outer.setEnabled(this._enabled && value !== undefined);
    this.changed();
  }
  set flashColor(value) {
    if (value.equals(this._flashColor))
      return;
    this._flashColor = value;
    this.requestRender();
  }
  set outerFlashColor(value) {
    if (value.equals(this._outerFlashColor))
      return;
    this._outerFlashColor = value;
    this.requestRender();
  }
  set flashTail(value) {
    if (value === this._flashTail)
      return;
    this._flashTail = value;
    this.requestRender();
  }
  set outerFlashTail(value) {
    if (value === this._outerFlashTail)
      return;
    this._outerFlashTail = value;
    this.requestRender();
  }
  set completionColor(value) {
    if (value.equals(this._completionColor))
      return;
    this._completionColor = value;
    this.requestRender();
  }
  set outerCompletionColor(value) {
    if (value.equals(this._outerCompletionColor))
      return;
    this._outerCompletionColor = value;
    this.requestRender();
  }
  set backgroundColor(value) {
    if (value.equals(this._backgroundColor))
      return;
    this._backgroundColor = value;
    this.requestRender();
  }
  onAnimationTick(deltaTime) {
    this.inner.advance(deltaTime);
    this.outer.advance(deltaTime);
    this.changed();
  }
  renderSelf(buffer) {
    if (!this.visible || this.isDestroyed || this.width <= 0)
      return;
    const running = this.inner.running;
    const completion = this.inner.completion;
    const flash = this.inner.flash;
    const glowLevel = this.inner.glowLevel;
    const releaseProgress = this.inner.glowReleaseProgress;
    const outerRunning = this.outer.running;
    const outerCompletion = this.outer.completion;
    const outerFlash = this.outer.flash;
    const outerGlowLevel = this.outer.glowLevel;
    const outerReleaseProgress = this.outer.glowReleaseProgress;
    if (glowLevel === 0 && releaseProgress === undefined && running === 0 && completion === 0 && flash === 0 && outerGlowLevel === 0 && outerReleaseProgress === undefined && outerRunning === 0 && outerCompletion === 0 && outerFlash === 0)
      return;
    const fronts = running === 0 ? undefined : this.inner.fronts(this.width);
    const outerFronts = outerRunning === 0 ? undefined : this.outer.fronts(this.width);
    const glowTail = Math.min(this._glowTail, Math.max(1, this.width - 2));
    const outerGlowTail = Math.min(this._outerGlowTail, Math.max(1, this.width - 2));
    const releaseSwell = this.inner.glowReleaseSwell;
    const releaseSpread = releaseSwell === 0 ? 0 : glowReleaseSpread(releaseProgress, glowTail, this.width);
    const outerReleaseSwell = this.outer.glowReleaseSwell;
    const outerReleaseSpread = outerReleaseSwell === 0 ? 0 : glowReleaseSpread(outerReleaseProgress, outerGlowTail, this.width);
    const flashTail = this._flashTail === undefined ? undefined : Math.min(this._flashTail, Math.max(1, this.width - 2));
    const outerFlashTail = this._outerFlashTail === undefined ? undefined : Math.min(this._outerFlashTail, Math.max(1, this.width - 2));
    for (let index = 0;index < this.width; index++) {
      const sweep = running === 0 ? 0 : Math.max(intensityAt(index, fronts[0], RUN_HEAD, RUN_TAIL), intensityAt(index, fronts[1], RUN_HEAD, RUN_TAIL)) * 0.14 * running;
      const outerSweep = outerRunning === 0 ? 0 : Math.max(intensityAt(index, outerFronts[0], RUN_HEAD, RUN_TAIL), intensityAt(index, outerFronts[1], RUN_HEAD, RUN_TAIL)) * 0.14 * outerRunning;
      blendTabPulseColor(this.renderColor, this._backgroundColor, this._glowColor, this._color, this._flashColor, this._completionColor, Math.max(glowLevel === 0 ? 0 : glowIntensityAt(index, glowTail) * GLOW_OPACITY * glowLevel, releaseSwell === 0 ? 0 : glowIntensityAt(index, releaseSpread) * GLOW_OPACITY * releaseSwell), sweep, flashTail === undefined ? flash : flash * tabFlashIntensity(index, flashTail), completion);
      if (!this._edge) {
        buffer.setCell(this.screenX + index, this.screenY, " ", DEFAULT_FOREGROUND, this.renderColor);
        continue;
      }
      blendTabPulseColor(this.outerRenderColor, this._backgroundColor, this._outerGlowColor, this._outerColor, this._outerFlashColor, this._outerCompletionColor, Math.max(outerGlowLevel === 0 ? 0 : glowIntensityAt(index, outerGlowTail) * GLOW_OPACITY * outerGlowLevel, outerReleaseSwell === 0 ? 0 : glowIntensityAt(index, outerReleaseSpread) * GLOW_OPACITY * outerReleaseSwell), outerSweep, outerFlashTail === undefined ? outerFlash : outerFlash * tabFlashIntensity(index, outerFlashTail), outerCompletion);
      buffer.setCell(this.screenX + index, this.screenY, this._edge === "above" ? "▄" : "▀", this.renderColor, this.outerRenderColor);
    }
  }
}
extend2({
  tab_pulse: TabPulseRenderable
});

// ../tui-base/src/component/shimmer-text.tsx
var DURATION = 1200;

class ShimmerTextRenderable extends MaskedTextRenderable {
  _shimmer = RGBA12.defaultForeground();
  elapsed = 0;
  constructor(ctx, options) {
    super(ctx, options);
    this.matrix[3] = this._shimmer.r;
    this.matrix[7] = this._shimmer.g;
    this.matrix[11] = this._shimmer.b;
    this.matrix[15] = 1;
    if (options.shimmer)
      this.shimmer = options.shimmer;
    this.live = true;
  }
  set shimmer(value) {
    if (value.equals(this._shimmer))
      return;
    this._shimmer = value;
    this.matrix[3] = value.r;
    this.matrix[7] = value.g;
    this.matrix[11] = value.b;
    this.requestRender();
  }
  renderSelf(buffer, deltaTime = 0) {
    if (!this.visible || this.isDestroyed || !Number.isFinite(this.width) || this.width <= 0 || this.height <= 0)
      return;
    this.elapsed = (this.elapsed + deltaTime) % DURATION;
    this.renderMasked(buffer, 0, (end) => {
      const front = -4 + coast(this.elapsed / DURATION) * (end + 22);
      return (column) => intensityAt(column, front, 4, 18);
    });
  }
}
extend3({
  shimmer_text: ShimmerTextRenderable
});
function ShimmerText(props) {
  const [local, text] = splitProps(props, ["shimmer"]);
  return (() => {
    var _el$ = _$createElement9("shimmer_text");
    _$spread(_el$, _$mergeProps(text, {
      get shimmer() {
        return local.shimmer;
      }
    }), false);
    return _el$;
  })();
}

// ../tui-base/src/component/spinner.tsx
function Spinner(props) {
  const theme = useTheme();
  const config = useConfig().data;
  const color = () => props.color ?? theme.text.muted;
  const [frame, setFrame] = createSignal12(0);
  createEffect5(() => {
    if (!(config.animations ?? true) || !props.shimmer)
      return;
    const timer = setInterval(() => setFrame((value) => (value + 1) % SPINNER_FRAMES.length), 80);
    onCleanup12(() => clearInterval(timer));
  });
  return _$createComponent16(Show9, {
    get when() {
      return config.animations ?? true;
    },
    get fallback() {
      return (() => {
        var _el$ = _$createElement10("text");
        _$insert8(_el$, (() => {
          var _c$ = _$memo6(() => !!props.children);
          return () => _c$() ? ["⋯ ", _$memo6(() => props.children)] : "⋯";
        })());
        _$effect9((_$p) => _$setProp9(_el$, "fg", color(), _$p));
        return _el$;
      })();
    },
    get children() {
      return _$createComponent16(Show9, {
        get when() {
          return props.shimmer;
        },
        get fallback() {
          return (() => {
            var _el$2 = _$createElement10("box"), _el$3 = _$createElement10("box"), _el$4 = _$createElement10("spinner");
            _$insertNode8(_el$2, _el$3);
            _$setProp9(_el$2, "flexDirection", "row");
            _$setProp9(_el$2, "gap", 1);
            _$insertNode8(_el$3, _el$4);
            _$setProp9(_el$3, "flexShrink", 0);
            _$setProp9(_el$4, "frames", SPINNER_FRAMES);
            _$setProp9(_el$4, "interval", 80);
            _$insert8(_el$2, _$createComponent16(Show9, {
              get when() {
                return props.children;
              },
              get children() {
                var _el$5 = _$createElement10("text");
                _$insert8(_el$5, () => props.children);
                _$effect9((_$p) => _$setProp9(_el$5, "fg", color(), _$p));
                return _el$5;
              }
            }), null);
            _$effect9((_p$) => {
              var _v$ = props.children ? 1 : 0, _v$2 = color();
              _v$ !== _p$.e && (_p$.e = _$setProp9(_el$2, "flexShrink", _v$, _p$.e));
              _v$2 !== _p$.t && (_p$.t = _$setProp9(_el$4, "color", _v$2, _p$.t));
              return _p$;
            }, {
              e: undefined,
              t: undefined
            });
            return _el$2;
          })();
        },
        children: (shimmer) => _$createComponent16(ShimmerText, {
          get fg() {
            return color();
          },
          get shimmer() {
            return shimmer();
          },
          get children() {
            return [_$memo6(() => SPINNER_FRAMES[frame()]), " ", _$memo6(() => props.children)];
          }
        })
      });
    }
  });
}

// ../tui-base/src/ui/dialog-prompt.tsx
import { useRenderer as useRenderer8 } from "@opentui/solid";
function DialogPrompt(props) {
  const dialog = useDialog();
  const renderer = useRenderer8();
  const theme = useTheme().surface("dialog");
  const cursorStyle = useCursorStyle();
  const [textareaTarget, setTextareaTarget] = createSignal13();
  let textarea;
  function confirm() {
    if (props.busy)
      return;
    props.onConfirm?.(textarea.plainText);
  }
  const handle = {
    setValue(value) {
      textarea.setText(value);
      textarea.gotoLineEnd();
    }
  };
  const extraActions = () => (props.actions ?? []).map((action) => ({
    title: action.title,
    command: action.command,
    disabled: props.busy,
    onTrigger: () => action.onTrigger(handle)
  }));
  Keymap.createLayer(() => ({
    mode: "modal",
    target: textareaTarget,
    enabled: textareaTarget() !== undefined && !props.busy,
    priority: 1,
    commands: [{
      id: "dialog.prompt.submit",
      title: "Submit dialog prompt",
      group: "Dialog",
      run: confirm
    }, ...(props.actions ?? []).map((action) => ({
      id: action.command,
      title: action.commandTitle ?? action.title,
      group: "Dialog",
      run: () => action.onTrigger(handle)
    }))]
  }));
  Keymap.createLayer(() => ({
    mode: "modal",
    enabled: props.onCancel !== undefined,
    priority: 1,
    commands: [{
      bind: "escape",
      title: "Back",
      group: "Dialog",
      run: () => {
        if (renderer.getSelection()) {
          renderer.clearSelection();
          return;
        }
        if (!props.busy)
          props.onCancel?.();
      }
    }]
  }));
  onMount5(() => {
    dialog.setSize(props.size ?? "medium");
    setTimeout(() => {
      if (!textarea || textarea.isDestroyed)
        return;
      if (props.busy)
        return;
      textarea.focus();
    }, 1);
    textarea.gotoLineEnd();
  });
  createEffect6(() => {
    if (!textarea || textarea.isDestroyed)
      return;
    const traits = props.busy ? {
      suspend: true,
      status: "BUSY"
    } : {};
    textarea.traits = traits;
    if (props.busy) {
      textarea.blur();
      return;
    }
    textarea.focus();
  });
  return _$createComponent17(DialogLayout, {
    footerGap: 2,
    get header() {
      return _$createComponent17(DialogHeader, {
        get title() {
          return props.title;
        },
        get description() {
          return props.subtitle;
        },
        onClose: () => {
          if (!props.busy)
            (props.onCancel ?? dialog.clear)();
        }
      });
    },
    get footer() {
      return {
        actions: {
          primary: [...extraActions(), {
            title: "submit",
            command: "dialog.prompt.submit",
            disabled: props.busy,
            onTrigger: confirm
          }]
        }
      };
    },
    get legacyFooter() {
      return _$createComponent17(Show10, {
        get when() {
          return !props.busy;
        },
        get fallback() {
          return (() => {
            var _el$3 = _$createElement11("text");
            _$insertNode9(_el$3, _$createTextNode6(`processing…`));
            _$effect10((_$p) => _$setProp10(_el$3, "fg", theme.text.muted, _$p));
            return _el$3;
          })();
        },
        get children() {
          return _$createComponent17(DialogFooter, {
            get actions() {
              return {
                secondary: [{
                  title: "submit",
                  command: "dialog.prompt.submit",
                  onTrigger: confirm
                }, ...extraActions()]
              };
            }
          });
        }
      });
    },
    get children() {
      var _el$ = _$createElement11("box"), _el$2 = _$createElement11("textarea");
      _$insertNode9(_el$, _el$2);
      _$setProp10(_el$, "gap", 1);
      _$insert9(_el$, () => props.description?.(), _el$2);
      _$use4((val) => {
        textarea = val;
        setTextareaTarget(val);
      }, _el$2);
      _$setProp10(_el$2, "height", 1);
      _$setProp10(_el$2, "wrapMode", "none");
      _$insert9(_el$, _$createComponent17(Show10, {
        get when() {
          return props.busy;
        },
        get children() {
          return _$createComponent17(Spinner, {
            get color() {
              return theme.text.muted;
            },
            get children() {
              return props.busyText ?? "Working…";
            }
          });
        }
      }), null);
      _$effect10((_p$) => {
        var _v$ = props.value, _v$2 = props.placeholder ?? "Enter text", _v$3 = theme.text.muted, _v$4 = props.busy ? theme.text.formfield.disabled : theme.text.formfield.base, _v$5 = props.busy ? theme.text.formfield.disabled : theme.text.formfield.base, _v$6 = props.busy ? theme.background.formfield.disabled : theme.text.base, _v$7 = cursorStyle();
        _v$ !== _p$.e && (_p$.e = _$setProp10(_el$2, "initialValue", _v$, _p$.e));
        _v$2 !== _p$.t && (_p$.t = _$setProp10(_el$2, "placeholder", _v$2, _p$.t));
        _v$3 !== _p$.a && (_p$.a = _$setProp10(_el$2, "placeholderColor", _v$3, _p$.a));
        _v$4 !== _p$.o && (_p$.o = _$setProp10(_el$2, "textColor", _v$4, _p$.o));
        _v$5 !== _p$.i && (_p$.i = _$setProp10(_el$2, "focusedTextColor", _v$5, _p$.i));
        _v$6 !== _p$.n && (_p$.n = _$setProp10(_el$2, "cursorColor", _v$6, _p$.n));
        _v$7 !== _p$.s && (_p$.s = _$setProp10(_el$2, "cursorStyle", _v$7, _p$.s));
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined,
        o: undefined,
        i: undefined,
        n: undefined,
        s: undefined
      });
      return _el$;
    }
  });
}

// ../tui-base/src/routes/session/btw-overlay.tsx
var BTW_QUEUE_CAPACITY = 3;
var BTW_SNAPSHOT_ROWS = 6;
var BTW_SNAPSHOT_ROW_CHARS = 1000;

class BtwController {
  #ask;
  #snapshot;
  #capacity;
  #run = createSignal14(undefined);
  #last = createSignal14(undefined);
  #queue = createSignal14([]);
  #visible = createSignal14(false);
  constructor(deps) {
    this.#ask = deps.ask;
    this.#snapshot = deps.snapshot;
    this.#capacity = deps.capacity ?? BTW_QUEUE_CAPACITY;
  }
  run() {
    return this.#run[0]();
  }
  last() {
    return this.#last[0]();
  }
  queueDepth() {
    return this.#queue[0]().length;
  }
  visible() {
    return this.#visible[0]();
  }
  get busy() {
    return this.run()?.status === "streaming" || this.queueDepth() > 0;
  }
  submit(question) {
    const text = question.trim();
    if (text === "")
      return "full";
    if (this.run()?.status === "streaming") {
      const queue = this.#queue[0]();
      if (queue.length >= this.#capacity)
        return "full";
      this.#queue[1]([...queue, text]);
      return "queued";
    }
    this.#start(text);
    return "started";
  }
  close() {
    this.#visible[1](false);
  }
  markVisible() {
    this.#visible[1](true);
  }
  dropQueue() {
    this.#queue[1]([]);
  }
  #start(question) {
    const runState = {
      question,
      answer: "",
      status: "streaming"
    };
    this.#run[1](runState);
    this.#snapshot().catch(() => []).then((snapshot) => this.#ask(question, snapshot, (full) => {
      this.#run[1]((prev) => prev === undefined ? prev : {
        ...prev,
        answer: full
      });
    })).then((answer) => {
      this.#settle(answer.startsWith("error:") ? "error" : "settled", answer);
    }).catch((error) => {
      this.#settle("error", `error: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
  #settle(status, answer) {
    const finished = this.#run[0]();
    if (finished !== undefined) {
      this.#last[1]({
        ...finished,
        answer,
        status
      });
      this.#run[1](undefined);
    }
    const [next, ...rest] = this.#queue[0]();
    this.#queue[1](rest);
    if (next !== undefined)
      this.#start(next);
  }
}
function BtwPanel(props) {
  const theme = useThemeOptional();
  const muted = () => theme?.text.muted ?? "#565f89";
  const accent = () => theme?.border.base ?? "#7aa2f7";
  const shown = () => props.controller.run() ?? props.controller.last();
  return (() => {
    var _el$ = _$createElement12("box"), _el$2 = _$createElement12("text"), _el$4 = _$createElement12("text");
    _$insertNode10(_el$, _el$2);
    _$insertNode10(_el$, _el$4);
    _$setProp11(_el$, "flexDirection", "column");
    _$setProp11(_el$, "gap", 1);
    _$setProp11(_el$, "paddingBottom", 1);
    _$insertNode10(_el$2, _$createTextNode7(`btw — side question`));
    _$insert10(_el$, _$createComponent18(Show11, {
      get when() {
        return shown();
      },
      get fallback() {
        return (() => {
          var _el$5 = _$createElement12("text");
          _$insertNode10(_el$5, _$createTextNode7(`no side question yet`));
          _$effect11((_$p) => _$setProp11(_el$5, "fg", muted(), _$p));
          return _el$5;
        })();
      },
      children: (run) => [(() => {
        var _el$7 = _$createElement12("text");
        _$insert10(_el$7, () => run().question);
        return _el$7;
      })(), _$createComponent18(Show11, {
        get when() {
          return _$memo8(() => run().status === "streaming")() && run().answer === "";
        },
        get fallback() {
          return (() => {
            var _el$0 = _$createElement12("text");
            _$insert10(_el$0, () => run().answer);
            return _el$0;
          })();
        },
        get children() {
          var _el$8 = _$createElement12("text");
          _$insertNode10(_el$8, _$createTextNode7(`Thinking…`));
          _$effect11((_$p) => _$setProp11(_el$8, "fg", muted(), _$p));
          return _el$8;
        }
      })]
    }), _el$4);
    _$insert10(_el$4, (() => {
      var _c$ = _$memo8(() => shown()?.status === "streaming");
      return () => _c$() ? `Running alongside the main task · Esc close${props.controller.queueDepth() > 0 ? ` · ${props.controller.queueDepth()} queued` : ""}` : `Not kept in the session · /btw reopens this answer${props.controller.queueDepth() > 0 ? ` · ${props.controller.queueDepth()} queued` : ""}`;
    })());
    _$effect11((_p$) => {
      var _v$ = accent(), _v$2 = muted();
      _v$ !== _p$.e && (_p$.e = _$setProp11(_el$2, "fg", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp11(_el$4, "fg", _v$2, _p$.t));
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$;
  })();
}
function createBtwOpener(deps) {
  const showPanel = () => {
    deps.controller.markVisible();
    deps.dialog.replace(() => _$createComponent18(BtwPanel, {
      get controller() {
        return deps.controller;
      }
    }), () => {
      deps.controller.close();
    });
  };
  return (argText) => {
    const question = argText.trim();
    if (question !== "") {
      const outcome = deps.controller.submit(question);
      if (outcome === "full")
        return "full";
      showPanel();
      return outcome;
    }
    if (deps.controller.last() !== undefined) {
      showPanel();
      return "review";
    }
    deps.dialog.replace(() => _$createComponent18(DialogPrompt, {
      title: "/btw",
      placeholder: "Ask anything",
      onConfirm: (text) => {
        const outcome = deps.controller.submit(text);
        if (outcome === "full") {
          deps.dialog.clear();
          return;
        }
        showPanel();
      }
    }), () => {
      deps.controller.close();
    });
    return "input";
  };
}
function createBtwSnapshotBuilder(seam) {
  return async () => {
    const id = seam.currentSessionId();
    if (id === undefined)
      return [];
    try {
      const rows = await seam.storedTranscript(id);
      return rows.slice(-BTW_SNAPSHOT_ROWS).map((row) => `${row.kind}: ${row.text}`.slice(0, BTW_SNAPSHOT_ROW_CHARS));
    } catch {
      return [];
    }
  };
}

// ../tui-base/src/seams/theme.ts
var DEFAULT_THEME = "opencode";
function bundledThemeNames() {
  return [...Object.keys(DEFAULT_THEMES), DEFAULT_THEME].sort();
}
function isBundledTheme(name) {
  return name === DEFAULT_THEME || Object.hasOwn(DEFAULT_THEMES, name);
}
function createThemeSeam(target) {
  return {
    setTheme(name) {
      if (!isBundledTheme(name))
        return false;
      return target.set(name);
    },
    current: () => target.selected,
    list: bundledThemeNames
  };
}

// ../tui-base/src/routes/session/powerline.tsx
import { createTextNode as _$createTextNode8 } from "@opentui/solid";
import { insertNode as _$insertNode11 } from "@opentui/solid";
import { effect as _$effect12 } from "@opentui/solid";
import { insert as _$insert11 } from "@opentui/solid";
import { createComponent as _$createComponent19 } from "@opentui/solid";
import { setProp as _$setProp12 } from "@opentui/solid";
import { createElement as _$createElement13 } from "@opentui/solid";
import { For as For6, Show as Show12 } from "solid-js";
var POWERLINE_COLORS = {
  brand: "#4D6BFE",
  provider: "#6A1B9A",
  thinking: {
    off: "#616161",
    minimal: "#78909C",
    low: "#5C6BC0",
    medium: "#42A5F5",
    high: "#26A69A",
    xhigh: "#FFA726",
    max: "#EF5350"
  },
  contextOk: "#4CAF50",
  contextWarn: "#FFC107",
  contextOrange: "#FF9800",
  contextDanger: "#F44336",
  messages: "#1565C0",
  tools: "#E65100",
  speed: "#00897B",
  cache: "#00695C"
};
var AUTO_FG_DARK = "#1a1a2e";
var AUTO_FG_LIGHT = "#ffffff";
function colorRgb(color) {
  if (typeof color !== "string") {
    return [Math.round(color.r * 255), Math.round(color.g * 255), Math.round(color.b * 255)];
  }
  const m = /^#?([0-9a-fA-F]{6})$/.exec(color);
  if (!m)
    return [0, 0, 0];
  const n = m[1];
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}
function brightness(color) {
  const [r, g, b] = colorRgb(color);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
function autoContrast(bg) {
  return brightness(bg) > 0.6 ? AUTO_FG_DARK : AUTO_FG_LIGHT;
}
function powerlinePalette(theme) {
  return {
    brand: theme.hue.accent[500],
    provider: theme.hue.interactive[500],
    thinking: {
      off: theme.text.faint,
      minimal: theme.text.muted,
      low: theme.hue.neutral[400],
      medium: theme.hue.neutral[600],
      high: theme.hue.accent[500],
      xhigh: theme.text.feedback.warning.base,
      max: theme.text.feedback.error.base
    },
    contextOk: theme.text.feedback.success.base,
    contextWarn: theme.text.feedback.warning.base,
    contextOrange: theme.text.feedback.error.muted,
    contextDanger: theme.text.feedback.error.base,
    messages: theme.hue.accent[700],
    tools: theme.text.feedback.warning.muted,
    speed: theme.hue.interactive[600],
    cache: theme.hue.interactive[700]
  };
}
function resolvePalette(theme) {
  if (!theme)
    return POWERLINE_COLORS;
  return powerlinePalette(theme);
}
function brandSegment(theme) {
  return {
    text: "dsh",
    bg: resolvePalette(theme).brand
  };
}
function providerSegment(provider, theme) {
  if (!provider)
    return null;
  return {
    text: provider,
    bg: resolvePalette(theme).provider
  };
}
function modelSegment(model, effort = "off", theme) {
  if (!model)
    return null;
  const label = effort === "off" ? `\uD83E\uDD16 ${model}` : `\uD83E\uDD16 ${model} ◕ ${effort}`;
  return {
    text: label,
    bg: resolvePalette(theme).thinking[effort]
  };
}
function contextSegment(pct, theme) {
  if (pct === null || !Number.isFinite(pct) || pct < 0)
    return null;
  const p = resolvePalette(theme);
  const bg = pct >= 90 ? p.contextDanger : pct >= 75 ? p.contextOrange : pct >= 60 ? p.contextWarn : p.contextOk;
  return {
    text: `\uD83E\uDDE0 ${Math.round(pct)}%`,
    bg
  };
}
function messagesSegment(n, theme) {
  if (!Number.isFinite(n) || n <= 0)
    return null;
  return {
    text: `\uD83D\uDCAC ${n}`,
    bg: resolvePalette(theme).messages
  };
}
function toolSegment(n, theme) {
  if (!Number.isFinite(n) || n <= 0)
    return null;
  return {
    text: `\uD83D\uDEE0 ${n}`,
    bg: resolvePalette(theme).tools
  };
}
function speedSegment(tps, theme) {
  if (tps === null || !Number.isFinite(tps) || tps < 0)
    return null;
  return {
    text: `⚡ ${Math.round(tps)} tok/s`,
    bg: resolvePalette(theme).speed
  };
}
function cacheSegment(rate, theme) {
  if (rate === null || !Number.isFinite(rate) || rate < 0)
    return null;
  return {
    text: `⚡ CH${rate.toFixed(1)}%`,
    bg: resolvePalette(theme).cache
  };
}
function PowerlineFooter(props) {
  return (() => {
    var _el$ = _$createElement13("box");
    _$setProp12(_el$, "style", {
      flexDirection: "row",
      paddingLeft: 1,
      flexShrink: 0
    });
    _$insert11(_el$, _$createComponent19(For6, {
      get each() {
        return props.left;
      },
      children: (seg, i) => {
        const next = () => props.left[i() + 1];
        return [(() => {
          var _el$4 = _$createElement13("text");
          _$insert11(_el$4, () => ` ${seg.text} `);
          _$effect12((_$p) => _$setProp12(_el$4, "style", {
            bg: seg.bg,
            fg: seg.fg ?? autoContrast(seg.bg)
          }, _$p));
          return _el$4;
        })(), _$createComponent19(Show12, {
          get when() {
            return next();
          },
          get fallback() {
            return (() => {
              var _el$5 = _$createElement13("text");
              _$insertNode11(_el$5, _$createTextNode8(``));
              _$effect12((_$p) => _$setProp12(_el$5, "style", {
                fg: seg.bg
              }, _$p));
              return _el$5;
            })();
          },
          children: (n) => (() => {
            var _el$7 = _$createElement13("text");
            _$insertNode11(_el$7, _$createTextNode8(``));
            _$effect12((_$p) => _$setProp12(_el$7, "style", {
              fg: seg.bg,
              bg: n().bg
            }, _$p));
            return _el$7;
          })()
        })];
      }
    }), null);
    _$insert11(_el$, _$createComponent19(Show12, {
      get when() {
        return props.right;
      },
      get children() {
        return [(() => {
          var _el$2 = _$createElement13("box");
          _$setProp12(_el$2, "style", {
            flexGrow: 1
          });
          return _el$2;
        })(), (() => {
          var _el$3 = _$createElement13("text");
          _$insert11(_el$3, () => props.right);
          _$effect12((_$p) => _$setProp12(_el$3, "style", {
            fg: props.theme?.text.base ?? "#e6e6e6"
          }, _$p));
          return _el$3;
        })()];
      }
    }), null);
    return _el$;
  })();
}
function sessionFooterSegments(data) {
  const theme = data.theme;
  const segs = [brandSegment(theme)];
  const add = (s) => {
    if (s)
      segs.push(s);
  };
  add(providerSegment(data.provider ?? "", theme));
  add(modelSegment(data.model ?? "", data.effort ?? "off", theme));
  add(contextSegment(data.contextPct ?? null, theme));
  add(cacheSegment(data.cacheHitRate ?? null, theme));
  add(messagesSegment(data.messages ?? 0, theme));
  add(toolSegment(data.tools ?? 0, theme));
  add(speedSegment(data.tps ?? null, theme));
  return segs;
}

// ../tui-base/src/seams/config.ts
var DEFAULT_CACHE_HIT_MODE = "lastMessage";
function narrowCacheHitMode(value) {
  return value === "session" ? "session" : DEFAULT_CACHE_HIT_MODE;
}
function readCacheHitMode(config) {
  return narrowCacheHitMode(config?.cacheHitMode);
}

// ../tui-base/src/routes/session/status-bar.tsx
import { effect as _$effect13 } from "@opentui/solid";
import { insert as _$insert12 } from "@opentui/solid";
import { createComponent as _$createComponent20 } from "@opentui/solid";
import { setProp as _$setProp13 } from "@opentui/solid";
import { createElement as _$createElement14 } from "@opentui/solid";
import { createSignal as createSignal15, onCleanup as onCleanup13, For as For7, Show as Show13 } from "solid-js";
var DEFAULT_VERBS = {
  think: ["Thinking", "Pondering", "Reasoning", "Reflecting", "Deliberating", "Mulling"],
  tool: ["Executing", "Running", "Processing", "Building"],
  stream: ["Writing", "Composing", "Typing", "Drafting"],
  approve: ["Waiting"]
};
var PHASE_ICON = {
  think: "\uD83E\uDDE0",
  tool: "\uD83D\uDEE0",
  stream: "\uD83D\uDCDD",
  approve: "⏳"
};
var TAIL = 5;
var RAMP = ["█", "▓", "▒", "░"];
var BAR_MS = 80;
var VERB_MS = 2500;
var FALLBACK_TRACK = "#565f89";
var FALLBACK_HEAD = "#7aa2f7";
function StatusBar(props) {
  const theme = useThemeOptional();
  const [tick, setTick] = createSignal15(0);
  const timer = setInterval(() => setTick((t) => t + 1), BAR_MS);
  onCleanup13(() => clearInterval(timer));
  const pools = () => ({
    think: props.verbs?.think ?? DEFAULT_VERBS.think,
    tool: props.verbs?.tool ?? DEFAULT_VERBS.tool,
    stream: props.verbs?.stream ?? DEFAULT_VERBS.stream,
    approve: props.verbs?.approve ?? DEFAULT_VERBS.approve
  });
  const headFg = () => {
    switch (props.phase) {
      case "think":
        return theme?.hue.accent[400] ?? FALLBACK_HEAD;
      case "tool":
        return theme?.text.feedback.success.base ?? "#4caf50";
      case "approve":
        return theme?.text.feedback.warning.base ?? "#e0af68";
      default:
        return theme?.hue.accent[500] ?? FALLBACK_HEAD;
    }
  };
  const TRACK_COLS = 15;
  const ASSEMBLY = 2;
  const row = () => {
    const phase = props.phase;
    if (phase === null)
      return [];
    const pool = pools()[phase];
    const verb = pool[Math.floor(tick() * BAR_MS / VERB_MS) % pool.length];
    const detail = props.detail?.() ?? "";
    const label = `${PHASE_ICON[phase]} ${verb}... ${props.elapsed()}s${detail ? ` · ${detail}` : ""}`;
    const trackFg = theme?.border.base ?? FALLBACK_TRACK;
    const head = headFg();
    const span = TRACK_COLS - ASSEMBLY;
    const step = Math.floor(tick() % (span * 2));
    const start = step < span ? step : span * 2 - step;
    const dirRight = step < span;
    const stern = dirRight ? start : start + ASSEMBLY;
    const tailEnd = dirRight ? stern - TAIL : stern + TAIL;
    const runs = [];
    let buf = "";
    let bufFg = trackFg;
    const flush = (f) => {
      if (buf)
        runs.push({
          text: buf,
          fg: bufFg
        });
      buf = "";
      bufFg = f;
    };
    for (let c = 0;c < TRACK_COLS; c++) {
      if (c === start) {
        flush(head);
        runs.push({
          text: "\uD83D\uDC33",
          fg: head
        });
        bufFg = trackFg;
        c += 1;
        continue;
      }
      const behind = dirRight ? stern - c : c - stern;
      const inTail = dirRight ? c < stern && c > tailEnd : c > stern && c < tailEnd;
      if (inTail && behind >= 0) {
        const ch = RAMP[Math.min(RAMP.length - 1, Math.floor(behind / 2) + 1)];
        if (head !== bufFg)
          flush(head);
        buf += ch;
      } else {
        if (trackFg !== bufFg)
          flush(trackFg);
        buf += "░";
      }
    }
    flush(trackFg);
    runs.push({
      text: ` ${label}`,
      fg: head
    });
    return runs;
  };
  return _$createComponent20(Show13, {
    get when() {
      return props.phase !== null;
    },
    get children() {
      var _el$ = _$createElement14("box");
      _$setProp13(_el$, "style", {
        flexDirection: "row",
        paddingLeft: 1,
        paddingRight: 1,
        height: 1,
        flexGrow: 0
      });
      _$insert12(_el$, _$createComponent20(For7, {
        get each() {
          return row();
        },
        children: (r) => (() => {
          var _el$2 = _$createElement14("text");
          _$setProp13(_el$2, "wrapMode", "none");
          _$insert12(_el$2, () => r.text);
          _$effect13((_$p) => _$setProp13(_el$2, "style", {
            fg: r.fg
          }, _$p));
          return _el$2;
        })()
      }));
      return _el$;
    }
  });
}

// ../tui-base/src/routes/session/turn-cancel.tsx
import { createComponent as _$createComponent21 } from "@opentui/solid";
import { effect as _$effect14 } from "@opentui/solid";
import { createTextNode as _$createTextNode9 } from "@opentui/solid";
import { insertNode as _$insertNode12 } from "@opentui/solid";
import { setProp as _$setProp14 } from "@opentui/solid";
import { createElement as _$createElement15 } from "@opentui/solid";
import { createSignal as createSignal16, onCleanup as onCleanup14, Show as Show14 } from "solid-js";
var CTRL_C_QUIT_WINDOW_MS = 500;
function createCtrlCGate(windowMs = CTRL_C_QUIT_WINDOW_MS, now = Date.now) {
  let armedAt;
  return {
    press() {
      const t = now();
      if (armedAt !== undefined && t - armedAt <= windowMs) {
        armedAt = undefined;
        return "quit";
      }
      armedAt = t;
      return "arm";
    },
    reset() {
      armedAt = undefined;
    }
  };
}
function createTurnCancel(props, onArm) {
  const windowMs = props.windowMs ?? CTRL_C_QUIT_WINDOW_MS;
  const gate = createCtrlCGate(windowMs);
  let timer;
  const disarm = () => {
    if (timer)
      clearTimeout(timer);
    timer = undefined;
    onArm(false);
  };
  return {
    escape() {
      if (!props.busy() || props.escapeYields?.())
        return false;
      props.interrupt();
      return true;
    },
    ctrlC() {
      if (gate.press() === "quit") {
        disarm();
        props.quit();
        return true;
      }
      if (props.busy())
        props.interrupt();
      if (timer)
        clearTimeout(timer);
      onArm(true);
      timer = setTimeout(() => {
        gate.reset();
        disarm();
      }, windowMs);
      return true;
    },
    dispose: disarm
  };
}
function TurnCancelKeys(props) {
  const theme = useThemeOptional();
  const [armed, setArmed] = createSignal16(false);
  const cancel = createTurnCancel(props, setArmed);
  onCleanup14(() => cancel.dispose());
  Keymap.createLayer(() => ({
    mode: "global",
    enabled: props.enabled(),
    commands: [{
      bind: "escape",
      title: "Interrupt current turn",
      group: "Session",
      run: () => cancel.escape()
    }, {
      bind: "ctrl+c",
      title: "Interrupt / quit (press twice)",
      group: "Session",
      run: () => cancel.ctrlC()
    }]
  }));
  return _$createComponent21(Show14, {
    get when() {
      return armed();
    },
    get children() {
      var _el$ = _$createElement15("box"), _el$2 = _$createElement15("text");
      _$insertNode12(_el$, _el$2);
      _$setProp14(_el$, "height", 1);
      _$setProp14(_el$, "flexShrink", 0);
      _$setProp14(_el$, "paddingLeft", 1);
      _$insertNode12(_el$2, _$createTextNode9(`Press Ctrl+C again to quit`));
      _$setProp14(_el$2, "wrapMode", "none");
      _$effect14((_$p) => _$setProp14(_el$2, "fg", theme?.text.feedback.warning.base ?? "#e0af68", _$p));
      return _el$;
    }
  });
}

// src/host-entry-v2.tsx
var inject = ["agents"];
function hasFfiFlag() {
  return (process.env.NODE_OPTIONS ?? "").includes("--experimental-ffi");
}
function reExecWithFfi() {
  if (hasFfiFlag())
    return false;
  const env = {
    ...process.env,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --experimental-ffi`.trim()
  };
  const child = spawn(process.argv[1], process.argv.slice(2), {
    env,
    stdio: "inherit",
    cwd: process.cwd()
  });
  child.on("exit", (code) => process.exit(code ?? 0));
  return true;
}
function appendDiagnostic(line) {
  try {
    __require("node:fs").appendFileSync("/tmp/b10a-render-diag.txt", `${line}
`);
  } catch {}
}
var overlays = new TurnOverlayController;
function V2SessionPage(props) {
  const seam = props.seam;
  const projection = createSeamRows(seam, () => seam.currentSessionId() ?? "", {
    onApprove: (name, args) => overlays.requestApproval(name, args)
  });
  const dialog = useDialog();
  const theme = useTheme();
  const themeSeam = createThemeSeam(useThemes());
  if (props.themeName && !themeSeam.setTheme(props.themeName)) {
    console.error(`[host-entry-v2] unknown theme ${props.themeName}; bundled: ${themeSeam.list().join(", ")}`);
  }
  const [composerBusy, setComposerBusy] = createSignal17(false);
  const [turnBusy, setTurnBusy] = createSignal17(false);
  const busy = () => composerBusy() || turnBusy();
  const [busySince, setBusySince] = createSignal17(0);
  const [msgs, setMsgs] = createSignal17(0);
  const [model, setModel] = createSignal17();
  const [now, setNow] = createSignal17(new Date);
  let composerRef;
  onMount6(() => {
    projection.load();
    seam.currentModelSelection().then(setModel);
    const timer = setInterval(() => setNow(new Date), 1000);
    onCleanup15(() => clearInterval(timer));
  });
  const elapsed = () => busy() ? Math.max(0, Math.floor((now().getTime() - busySince()) / 1000)) : 0;
  const send = (text) => {
    setMsgs((n) => n + 1);
    setTurnBusy(true);
    setBusySince(Date.now());
    const done = projection.send(text);
    done.finally(() => setTurnBusy(false));
    return done;
  };
  const cacheRate = () => {
    turnBusy();
    const mode = readCacheHitMode(seam.configLoad?.());
    return seam.cacheHitRate?.(mode) ?? null;
  };
  const segments = () => sessionFooterSegments({
    provider: model()?.providerID,
    model: model()?.modelID,
    messages: msgs(),
    tools: 0,
    cacheHitRate: cacheRate(),
    theme
  });
  let cmdOrdinal = 0;
  const pickOne = (title, options) => new Promise((resolvePick) => {
    let settled = false;
    const done = (value) => {
      if (settled)
        return;
      settled = true;
      dialog.clear();
      resolvePick(value);
    };
    dialog.replace(() => createComponent2(DialogSelect, {
      title,
      renderFilter: false,
      options: options.map((option) => ({
        title: option.title,
        value: option.value
      })),
      onSelect: (option) => done(option.value),
      onCancel: () => done(undefined)
    }), () => done(undefined));
  });
  const btw = new BtwController({
    ask: (question, snapshot, onDelta) => seam.btwAsk ? seam.btwAsk(question, snapshot, onDelta) : Promise.resolve("error: /btw unavailable"),
    snapshot: createBtwSnapshotBuilder(seam)
  });
  const openBtw = createBtwOpener({
    controller: btw,
    dialog
  });
  const slash = createSlashHost({
    seam,
    say: (text) => projection.apply({
      type: "message.part.updated",
      details: {
        messageID: "cmd",
        part: {
          type: "text",
          id: `cmd-${++cmdOrdinal}`,
          text
        }
      }
    }),
    clear: () => projection.hydrate([]),
    reload: () => {
      const settled = projection.load();
      seam.currentModelSelection().then(setModel);
      return settled;
    },
    quit: props.quit,
    pickOne,
    openBtw: (argText) => void openBtw(argText),
    themes: {
      current: () => themeSeam.current(),
      list: () => themeSeam.list(),
      set: (name) => {
        const applied = themeSeam.setTheme(name);
        if (applied) {
          try {
            seam.configSave?.({
              theme: name
            });
          } catch (error) {
            console.error("[host-entry-v2] theme persist failed:", error);
          }
        }
        return applied;
      }
    }
  });
  const overlayHost = createComponent2(TurnOverlayHost, {
    controller: overlays,
    reclaimFocus: () => {
      if (composerRef && !composerRef.focused())
        composerRef.focus();
    }
  });
  const root = createElement("box");
  spread(root, {
    flexDirection: "column",
    width: "100%",
    height: "100%",
    backgroundColor: "black",
    get children() {
      return [
        createComponent2(Transcript, {
          seam,
          projection,
          get children() {
            return createComponent2(SessionComposer, {
              seam,
              send,
              onBusyChange: setComposerBusy,
              ref: (r) => composerRef = r,
              slashKeyFilter: slash.slashKeyFilter,
              slashSync: (buffer) => slash.controller.sync(buffer, slash.commands),
              interceptSubmit: slash.interceptSubmit,
              slashPalette: () => createComponent2(SlashPalette, {
                controller: slash.controller,
                commands: slash.commands
              }),
              slashHeight: () => slash.controller.rows()
            });
          }
        }),
        createComponent2(TurnCancelKeys, {
          busy,
          interrupt: () => seam.interrupt(),
          quit: props.quit,
          enabled: () => dialog.stack.length === 0,
          escapeYields: () => slash.controller.open
        }),
        createComponent2(StatusBar, {
          get phase() {
            return busy() ? "stream" : null;
          },
          elapsed
        }),
        createComponent2(PowerlineFooter, {
          get left() {
            return segments();
          },
          get right() {
            return clock(now());
          },
          theme
        }),
        overlayHost
      ];
    }
  });
  return root;
}
function clock(d) {
  return d.toTimeString().slice(0, 8);
}
function ErrorBoundaryDiagnostics(props) {
  return createComponent2(ErrorBoundary, {
    fallback: (error) => {
      appendDiagnostic(`[v2 render error] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      process.stderr.write("dsh-opentui view crashed: " + String(error instanceof Error ? error.message : error) + `
`);
      process.exit(2);
      return null;
    },
    get children() {
      return props.children;
    }
  });
}
function apply(ctx, config) {
  const session = new HostSession(ctx);
  const seam = new HostSessionSeam(session);
  registerTurnOverlays(seam, overlays);
  // Boot restore precedence: the persisted profile config.json choice wins
  // over the embedder pin (the e2e image bakes theme: catppuccin-mocha into
  // the plugin config, which shadowed configLoad().theme and made the F7b
  // persist+restore pair dead code at boot — 67-theme capture-verified).
  const themeName = session.configLoad().theme ?? config?.theme;
  mountEngine({}).then(({
    renderer
  }) => {
    render(() => createComponent2(ConfigProvider, {
      config: resolve3({}, {
        terminalSuspend: true
      }),
      get children() {
        return createComponent2(Keymap.Provider, {
          get children() {
            return createComponent2(ToastProvider, {
              get children() {
                return createComponent2(ThemeProvider, {
                  mode: "dark",
                  source: {
                    discover: async () => ({})
                  },
                  get children() {
                    return createComponent2(ClipboardProvider, {
                      value: {
                        read: async () => {
                          return;
                        },
                        write: async () => {}
                      },
                      get children() {
                        return createComponent2(DialogProvider, {
                          get children() {
                            return createComponent2(ErrorBoundaryDiagnostics, {
                              get children() {
                                return createComponent2(V2SessionPage, {
                                  seam,
                                  themeName,
                                  quit: () => process.exit(0)
                                });
                              }
                            });
                          }
                        });
                      }
                    });
                  }
                });
              }
            });
          }
        });
      }
    }), renderer).catch((error) => {
      appendDiagnostic(`[v2 boot render failed] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      process.stderr.write("dsh-opentui boot failed: " + String(error instanceof Error ? error.message : error) + `
`);
    });
  }).catch((e) => {
    const msg = String(e);
    if (/native FFI is not available/.test(msg) && reExecWithFfi())
      return;
    process.stderr.write("dsh-opentui boot failed: " + msg + `
`);
  });
}
var plugin = {
  name: "dsh-opentui",
  inject,
  apply,
  Config
};
var host_entry_v2_default = plugin;
export {
  Config,
  apply,
  host_entry_v2_default as default,
  plugin
};
