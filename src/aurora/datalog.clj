(ns aurora.datalog
  (:require [aurora.match :as match]))

(defn guard? [pattern]
  (seq? pattern))

(defn bind-in [pattern bound]
  (cond
   (and (seq? pattern) (= 'quote (first pattern))) pattern
   (bound (match/->var pattern)) (match/->var pattern)
   (coll? pattern) (into (empty pattern) (map #(bind-in % bound) pattern))
   :else pattern))

(defn query->cljs [outputs clauses checks]
  (let [facts (gensym "facts")
        result (gensym "result")
        bound (atom #{})
        patterns (filter #(not (guard? %)) clauses)
        guards (filter guard? clauses)
        bound-patterns (for [pattern patterns]
                         (let [bound-pattern (bind-in pattern @bound)]
                           (swap! bound clojure.set/union (match/->vars pattern))
                           bound-pattern))]
    `(fn [~facts]
       (let [~@(interleave (match/->vars clauses) (repeat nil))
             ~result (transient #{})]
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
              ~@(for [check checks]
                  `(assert ~check))
              ~@(for [output outputs]
                  `(~'js* ~(str result " = ~{}") (conj! ~result ~output))))
           (reverse bound-patterns))
         (persistent! ~result)))))

(defn split-on [k elems]
  (let [[left right] (split-with #(not= k %) elems)]
    [left (rest right)]))

(defn parse-outputs&clauses&checks [outputs&clauses&checks]
  ;; syntax is [output+ :where clause+ :check check+])
  (let [[outputs clauses&checks] (split-on :where outputs&clauses&checks)
        [clauses checks] (split-on :check clauses&checks)]
    [outputs clauses checks]))

(defmacro rule [& outputs&clauses&checks]
  (apply query->cljs (parse-outputs&clauses&checks outputs&clauses&checks)))

(defmacro defrule [name & outputs&clauses&checks]
  `(def ~name (rule ~@outputs&clauses&checks)))

(defmacro query [knowledge & outputs&clauses&checks]
  `((rule ~@outputs&clauses&checks) (:facts ~knowledge)))
