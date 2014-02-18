(ns aurora.code
  (:require aurora.util
            [aurora.datalog :as datalog]
            [aurora.schema :as schema :refer [errors required exclusive group has-one id! ids! true! text! number! vector! map!]])
  (:require-macros [aurora.macros :refer [check]]
                   [aurora.datalog :refer [rule q1 q+ q* q?]]))

(def rules
  ;; NOTE this is hand-stratified
  ;; NOTE would prefer to merge :data and :pattern but requires more sophisticated rules eg (:contains ?id)
  [[(required :page :page/args :page/steps)
    (required :match :match/arg :match/branches)
    (required :branch :branch/pattern :branch/guards :branch/action)
    (required :call :call/fun :call/args)
    (required :js :js/name)
    (required :constant :constant/value)]

   [(exclusive :data :data/nil :data/ref :data/text :data/number :data/vector :data/map)
    (exclusive :pattern :pattern/any :pattern/ref :pattern/text :pattern/number :pattern/vector :pattern/map)]

   [(group :value :data :call :js :page)] ;; NOTE this is probably wrong, still got def and ref confused

   [(exclusive :node :page :match :branch :call :js :constant :data :pattern)]

   [(has-one :page/args (ids!))
    (has-one :page/steps (ids! :node))
    (has-one :match/arg (id!))
    (has-one :match/branches (ids! :branch))
    (has-one :branch/pattern (id! :pattern))
    (has-one :branch/guards (ids! :value))
    (has-one :branch/action (id! :value))
    (has-one :constant/value (id! :data)) ;; creates identity - necessary for mutable code
    (has-one :data/nil true!)
    (has-one :data/ref (id!))
    (has-one :data/text text!)
    (has-one :data/number number!)
    (has-one :data/vector (vector! (id! :data)))
    (has-one :data/map (map! (id! :data) (id! :data)))
    (has-one :pattern/any true!)
    (has-one :pattern/ref (id!))
    (has-one :pattern/text text!)
    (has-one :pattern/number number!)
    (has-one :pattern/vector (vector! (id! :pattern)))
    (has-one :pattern/map (map! (id! :pattern) (id! :pattern))) ;; would prefer :data keys - maybe constants are not patterns?
    (has-one :call/fun (id! :value))
    (has-one :call/args (ids!))
    (has-one :js/name text!)]])

;; examples

(def stdlib
  #{[:fun_mult :js/name "cljs.core._STAR_.call"]
    [:fun_sub :js/name "cljs.core._.call"]
    [:fun_number :js/name "cljs.core.number_QMARK_"]
    [:replace :js/name "replace"] ;; temporary hack
    })

(def example-a
  #{[:root :page/args [:arg_a :arg_b :arg_c]]
    [:root :page/steps [:b_squared :four :four_a_c :result]]
    [:b_squared :call/fun :fun_mult]
    [:b_squared :call/args [:nil :arg_b :arg_b]]
    [:four :data/number 4]
    [:four_a_c :call/fun :fun_mult]
    [:four_a_c :call/args [:nil :four :arg_a :arg_c]]
    [:result :call/fun :fun_sub]
    [:result :call/args [:nil :b_squared :four_a_c]]})

(errors (datalog/knowledge (clojure.set/union stdlib example-a) rules))

(q? (datalog/knowledge (clojure.set/union stdlib example-a) rules) [:root :page true])

(def example-b
  #{[:root :page/args [:arg_x]]
    [:root :page/steps [:result]]
    [:result :match/arg :x]
    [:result :match/branches [:branch_map :branch_nested]]
    [:branch_map :branch/pattern :pattern_map]
    [:branch_map :branch/guards [:number_a :number_b]]
    [:branch_map :branch/action :action_map]
    [:pattern_map :pattern/map {:text_a :bind_a :text_b :bind_b}]
    [:text_a :pattern/text "a"]
    [:text_b :pattern/text "a"]
    [:bind_a :pattern/any true]
    [:bind_b :pattern/any true]
    [:number_a :call/fun :fun_number]
    [:number_a :call/args [:bind_a]]
    [:number_b :call/fun :fun_number]
    [:number_b :call/args [:bind_b]]
    [:action_map :call/fun :fun_sub]
    [:action_map :call/args [:bind_a :bind_b]]
    [:branch_nested :branch/pattern :pattern_nested]
    [:branch_nested :branch/guards []]
    [:branch_nested :branch/action :action_nested]
    [:pattern_nested :pattern/map {:text_vec :bind_y}]
    [:text_vec :pattern/text "vec"]
    [:bind_y :pattern/any true]
    [:action_nested :call/fun :vec]
    [:action_nested :call/args [:bind_y]]
    [:vec :page/args [:arg_y]]
    [:vec :page/steps [:vec_result]]
    [:vec_result :match/arg :x]
    [:vec_result :match/branches [:branch_only]]
    [:branch_only :branch/pattern :pattern_only]
    [:branch_only :branch/guards []]
    [:branch_only :branch/action :action_only]
    [:pattern_only :pattern/vector [:bind_z :text_foo]]
    [:bind_z :pattern/any true]
    [:text_foo :pattern/text "foo"]
    [:action_only :call/fun :replace]
    [:action_only :call/args [:bind_z :text_more]]
    [:text_more :data/text "more foo!"]})

(errors (datalog/knowledge (clojure.set/union stdlib example-b) rules))

(q* (datalog/knowledge (clojure.set/union stdlib example-b) rules) [?id :match true] :return id)
