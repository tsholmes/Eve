(ns aurora.ast
  (:require aurora.util
            [aurora.datalog :as datalog :refer [has-one required exclusive id!]])
  (:require-macros [aurora.macros :refer [check]]
                   [aurora.datalog :refer [rule q1 q+ q* q?]]))

(defn vector! [elem!]
  (fn [kn value]
    (check (vector? value))
    (check (every? #(elem! kn %) value))))

(defn map! [key! val!]
  (fn [kn value]
    (check (map? value))
    (check (every? #(key! kn %) (keys value)))
    (check (every? #(val! kn %) (vals value)))))

(defn ids! [& as]
  (vector! (apply id! as)))

(defn text! [kn value]
  (check (string? value)))

(defn number! [kn value]
  (check (number? value)))

(defn true! [kn value]
  (check (true? value)))

(def rules
  [(has-one :page/args (ids!))
   (has-one :page/steps (ids!))
   (has-one :match/arg (id!))
   (has-one :match/branches (ids!))
   (has-one :branch/pattern (id!))
   (has-one :branch/guards (ids!))
   (has-one :branch/action (id!))
   (has-one :constant/value (id!)) ;; creates identity - necessary for mutable code
   (has-one :data/nil true!)
   (has-one :data/ref (id!))
   (has-one :data/text text!)
   (has-one :data/number number!)
   (has-one :data/vector (vector! (id!)))
   (has-one :data/map (map! (id!) (id!)))
   (has-one :pattern/any true!)
   (has-one :pattern/ref (id!))
   (has-one :pattern/text text!)
   (has-one :pattern/number number!)
   (has-one :pattern/vector (vector! (id!)))
   (has-one :pattern/map (map! (id!) (id!)))
   (has-one :call/fun (id!))
   (has-one :call/args (ids!))
   (has-one :js/name text!)

   (required :page :page/args :page/steps)
   (required :match :match/arg :match/branches)
   (required :branch :branch/pattern :branch/guards :branch/action)
   (required :call :call/fun :call/args)
   (required :js :js/name)
   (required :constant :constant/value)

   (exclusive :data :data/nil :data/ref :data/text :data/number :data/vector :data/map)
   (exclusive :pattern :pattern/any :pattern/ref :pattern/text :pattern/number :pattern/vector :pattern/map)

   ])

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

(datalog/knowledge (clojure.set/union stdlib example-a) rules)

(q? (datalog/knowledge (clojure.set/union stdlib example-a) rules) ["root" :page true])

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
    ["text_foo" :data/text "foo"]
    ["action_only" :call/fun "replace"]
    ["action_only" :call/args ["bind_z" "text_more"]]
    ["text_more" :data/text "more foo!"]})

(datalog/knowledge (clojure.set/union stdlib example-b) rules)

(q* (datalog/knowledge (clojure.set/union stdlib example-b) rules) [?id :match true] :return id)
