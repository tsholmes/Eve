(ns aurora.datalog
  (:require [aurora.match :as match]
            [aurora.macros :refer [check]]))

(defn guard? [pattern]
  (seq? pattern))

(defn bind-in [pattern bound]
  (cond
   (and (seq? pattern) (= 'quote (first pattern))) pattern
   (bound (match/->var pattern)) (match/->var pattern)
   (coll? pattern) (into (empty pattern) (map #(bind-in % bound) pattern))
   :else pattern))

(defn query->cljs [{:keys [where ignore return]} facts]
  (let [result (gensym "result")
        bound (atom #{})
        patterns (filter #(not (guard? %)) where)
        guards (filter guard? where)
        bound-patterns (for [pattern patterns]
                         (let [bound-pattern (bind-in pattern @bound)]
                           (swap! bound clojure.set/union (match/->vars pattern))
                           bound-pattern))]
    `(let [~@(interleave (match/->vars where) (repeat nil))
           ~result (transient [])]
       ~(reduce
         (fn [tail bound-pattern]
           (let [fact (gensym "fact")]
             `(doseq [~fact ~facts]
                (try
                  ~(match/pattern->cljs bound-pattern fact)
                  ~tail
                  (catch aurora.match.MatchFailure e#)))))
         `(do
            ~@(for [guard guards]
                (match/test guard))
            ~@(for [action ignore]
                action)
            ~@(for [output return]
                `(~'js* ~(str result " = ~{}") (conj! ~result ~output))))
         (reverse bound-patterns))
       (persistent! ~result))))

(defn split-on [k elems]
  (let [[left right] (split-with #(not= k %) elems)]
    [left (rest right)]))

(defn parse-args [args]
  ;; syntax is [clause+ (:ignore|:return form+)*]
  (loop [parts {}
         part :where
         args args]
    (let [[left right] (split-with #(not (#{:ignore :return} %)) args)]
      (let [parts (update-in parts [part] concat left)]
        (if (empty? right)
          parts
          (recur parts (first right) (rest right)))))))

(defmacro rule [& args]
  (let [facts (gensym "facts")]
    `(fn [~facts]
       (into #{}
             ~(query->cljs (parse-args args) facts)))))

(defmacro defrule [name & args]
  `(def ~name (rule ~@args)))

(defmacro q* [knowledge & args]
  (let [facts (gensym "facts")]
    `(let [~facts (:cache-eavs ~knowledge)]
       (into #{}
             ~(query->cljs (parse-args args) facts)))))

(defmacro q1 [knowledge & args]
  `(let [result# (q* ~knowledge ~@args)]
     (check (= (count result#) 1))
     (first result#)))

(defmacro q+ [knowledge & args]
  `(let [result# (q* ~knowledge ~@args)]
     (check (>= (count result#) 1))
     result#))

(defmacro q? [knowledge & args]
  `(let [any# (atom false)]
     (q* ~knowledge ~@args :ignore (reset! any# true))
     @any#))

(defmacro q! [knowledge & args]
  (let [facts (gensym "facts")]
    `(let [~facts (:cache-eavs ~knowledge)
           values# ~(query->cljs (parse-args args) facts)
           result# (into #{} values#)]
       (check (= (count values#) (count result#)))
       result#)))
