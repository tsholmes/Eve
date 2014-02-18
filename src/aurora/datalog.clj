(ns aurora.datalog
  (:require [aurora.match :as match]
            [aurora.macros :refer [check]]))

(defn guard? [pattern]
  (and (seq? pattern) (not= :in (first pattern))))

(defn subquery? [pattern]
  (and (seq? pattern) (= :in (first pattern))))

(defn bind-in [pattern bound]
  (cond
   (and (seq? pattern) (= 'quote (first pattern))) pattern
   (bound (match/->var pattern)) (match/->var pattern)
   (seq? pattern) (into nil (reverse (map #(bind-in % bound) pattern)))
   (coll? pattern) (into (empty pattern) (map #(bind-in % bound) pattern))
   :else pattern))

(defn subquery->cljs [[_ pattern collection] tail]
  (assert (empty? (match/->vars collection)) (str "Not ground: " (pr-str collection)))
  (let [elem (gensym "elem")]
    `(doseq [~elem ~collection]
       ~(match/pattern->cljs pattern elem)
       ~tail)))

(defn clause->cljs [[e a v :as eav] cache-eavs e->a->vs a->e->vs tail]
  (let [eav-sym (gensym "eav")
        e-sym (gensym "e")
        a-sym (gensym "a")
        v-sym (gensym "v")
        vs-sym (gensym "vs")]
    (cond
     (and (match/constant? a) (match/constant? e))
     `(doseq [~v-sym (get-in ~e->a->vs [~e ~a])]
        (try
          ~(match/pattern->cljs v v-sym)
          ~tail
          (catch aurora.match.MatchFailure e#)))

     (match/constant? a)
     `(doseq [[~e-sym ~vs-sym] (get ~a->e->vs ~a)]
        (try
          ~(match/pattern->cljs e e-sym)
          (doseq [~v-sym ~vs-sym]
            (try
              ~(match/pattern->cljs v v-sym)
              ~tail
              (catch aurora.match.MatchFailure e#)))
          (catch aurora.match.MatchFailure e#)))

     (match/constant? e)
     `(doseq [[~a-sym ~vs-sym] (get ~e->a->vs ~e)]
        (try
          ~(match/pattern->cljs a a-sym)
          (doseq [~v-sym ~vs-sym]
            (try
              ~(match/pattern->cljs v v-sym)
              ~tail
              (catch aurora.match.MatchFailure e#)))
          (catch aurora.match.MatchFailure e#)))

     :else
     `(doseq [[~e-sym ~a-sym ~v-sym] ~cache-eavs]
        (try
          ~(match/pattern->cljs e e-sym)
          ~(match/pattern->cljs a a-sym)
          ~(match/pattern->cljs v v-sym)
          ~tail
          (catch aurora.match.MatchFailure e#)))
     )))

(defn query->cljs [{:keys [where ignore return]} knowledge]
  (let [result (gensym "result")
        cache-eavs (gensym "cache->eavs")
        e->a->vs (gensym "e->a->vs")
        a->e->vs (gensym "a->e->vs")
        bound (atom #{})
        patterns (filter #(not (guard? %)) where)
        guards (filter guard? where)
        bound-patterns (for [pattern patterns]
                         (let [bound-pattern (bind-in pattern @bound)]
                           (swap! bound clojure.set/union (match/->vars pattern))
                           bound-pattern))]
    `(let [{~cache-eavs :cache-eavs ~e->a->vs :e->a->vs ~a->e->vs :a->e->vs} ~knowledge
           ~@(interleave (match/->vars where) (repeat nil))
           ~result (transient [])]
       ~(reduce
         (fn [tail bound-pattern]
           (cond
            (subquery? bound-pattern)
            (subquery->cljs bound-pattern tail)

            :else
            (clause->cljs bound-pattern cache-eavs e->a->vs a->e->vs tail)))
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
  (let [knowledge (gensym "knowledge")]
    `(fn [~knowledge]
       (into #{}
             ~(query->cljs (parse-args args) knowledge)))))

(defmacro defrule [name & args]
  `(def ~name (rule ~@args)))

(defmacro q* [knowledge & args]
  (let [knowledge-sym (gensym "knowledge")]
    `(let [~knowledge-sym ~knowledge]
       (into #{}
             ~(query->cljs (parse-args args) knowledge-sym)))))

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
  (let [knowledge-sym (gensym "knowledge")]
    `(let [~knowledge-sym ~knowledge
           values# ~(query->cljs (parse-args args) knowledge-sym)
           result# (into #{} values#)]
       (check (= (count values#) (count result#)))
       result#)))

