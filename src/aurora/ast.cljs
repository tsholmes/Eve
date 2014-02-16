(ns aurora.ast
  (:require aurora.util
            [aurora.datalog :as datalog :refer [->Schema one! many!]])
  (:require-macros [aurora.macros :refer [check]]
                   [aurora.datalog :refer [q1 q+ q*]]))

;; TODO
;; should checks be imperative or generate facts?
;; add rules for step, page, pattern etc

(defn vector! [elem!]
  (fn [value]
    (check (vector? value))
    (check (every? elem! value))))

(defn map! [key! val!]
  (fn [value]
    (check (map? value))
    (check (every? key! (keys value)))
    (check (every? val! (vals value)))))

(defn id! [value]
  (check (string? value)))

(def ids!
  (vector! id!))

(defn text! [value]
  (check (string? value)))

(defn number! [value]
  (check (number? value)))

(defn true! [value]
  (check (true? value)))

(def schemas
  [(->Schema :page/args ids! one!)
   (->Schema :page/steps #(and (ids! %) (check (>= (count %) 1))) one!)
   (->Schema :match/arg id! one!)
   (->Schema :match/branches ids! one!)
   (->Schema :branch/pattern id! one!)
   (->Schema :branch/guards ids! one!)
   (->Schema :branch/action id! one!)
   (->Schema :data/nil true! one!)
   (->Schema :data/ref id! one!)
   (->Schema :data/text text! one!)
   (->Schema :data/number number! one!)
   (->Schema :data/vector (vector! id!) one!)
   (->Schema :data/map (map! id! id!) one!)
   (->Schema :pattern/any true! one!)
   (->Schema :pattern/bind id! one!)
   (->Schema :call/fun id! one!)
   (->Schema :call/args ids! one!)
   (->Schema :js/name text! one!)])

(def stdlib
  #{["fun_mult" :js/name "cljs.core._STAR_.call"]
    ["fun_sub" :js/name"cljs.core._.call"]
    ["fun_number" :js/name "cljs.core.number_QMARK_"]})

(def example-a
  #{["root" :page/args ["arg_a" "arg_b" "arg_c"]]
    ["root" :page/steps ["b_squared" "four" "four_a_c" "result"]]
    ["b_squared" :call/fun "fun_mult"]
    ["b_squared" :call/args ["nil" "arg_b" "arg_b"]]
    ["four" :data/number 4]
    ["four_a_c" :call/fun "fun_mult"]
    ["four_a_c" :call/args ["nil" "four" "arg_a" "arg_c"]]
    ["result" :call/fun "fun_sub"]
    ["result" :call/args ["nil" "b_squared" "four_a_c"]]})

(datalog/knowledge (clojure.set/union stdlib example-a) [] schemas)

(def example-b
  #{["root" :page/args ["arg_x"]]
    ["root" :page/steps ["result"]]
    ["result" :match/arg "x"]
    ["result" :match/branches ["branch_map" "branch_nested"]]
    ["branch_map" :branch/pattern "pattern_map"]
    ["branch_map" :branch/guards ["number_a" "number_b"]]
    ["branch_map" :branch/action "action_map"]
    ["pattern_map" :data/map {"text_a" "bind_a" "text_b" "bind_b"}]
    ["text_a" :data/text "a"]
    ["text_b" :data/text "b"]
    ["bind_a" :pattern/bind "any"]
    ["bind_b" :pattern/bind "any"]
    ["number_a" :call/fun "fun_number"]
    ["number_a" :call/args ["bind_a"]]
    ["number_b" :call/fun "fun_number"]
    ["number_b" :call/args ["bind_b"]]
    ["action_map" :call/fun "fun_sub"]
    ["action_map" :call/args ["bind_a" "bind_b"]]
    ["branch_nested" :branch/pattern "pattern_nested"]
    ["branch_nested" :branch/guards []]
    ["branch_nested" :branch/action "action_nested"]
    ["pattern_nested" :data/map {"text_vec" "bind_y"}]
    ["text_vec" :data/text "vec"]
    ["bind_y" :pattern/bind "any"]
    ["action_nested" :call/fun "vec"]
    ["action_nested" :call/args ["bind_y"]]
    ["vec" :page/args ["arg_y"]]
    ["vec" :page/steps ["vec_result"]]
    ["vec_result" :match/arg "x"]
    ["vec_result" :match/branches ["branch_only"]]
    ["branch_only" :branch/pattern "pattern_only"]
    ["branch_only" :branch/guards []]
    ["branch_only" :branch/action "action_only"]
    ["pattern_only" :data/vec ["bind_z" "text_foo"]]
    ["bind_z" :pattern/bind "any"]
    ["text_foo" :data/test "foo"]
    ["action_only" :call/fun "replace"]
    ["action_only" :call/args ["bind_z" "text_more"]]
    ["text_more" :data/text "more foo!"]})

(datalog/knowledge (clojure.set/union stdlib example-b) [] schemas)
