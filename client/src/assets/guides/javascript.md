# JavaScript — a quick recap

JavaScript is dynamically typed and famously forgiving about type coercion — most of the language's well-known gotchas come from exactly how much it's willing to convert one type into another without being asked.

## Facts worth knowing

- **Variables aren't typed, values are.** `let x = 1; x = "now a string";` is completely legal — nothing about `x` itself was ever locked to a number.
- **`==` coerces, `===` doesn't.** `'5' == 5` is `true` because `==` converts one side before comparing; `'5' === 5` is `false` because `===` never converts anything. Default to `===` unless there's a specific reason not to.
- **`undefined` and `null` mean different things.** `undefined` is what you get when something was never assigned — a declared-but-empty variable, a missing object property, a function with no `return`. `null` is an explicit "no value," assigned on purpose.
- **Only six values are falsy**: `false`, `0`, `''` (empty string), `null`, `undefined`, `NaN`. Everything else is truthy — including `'0'` (a non-empty string) and `[]` (an empty array).
- **`NaN` isn't equal to anything, including itself.** `NaN === NaN` is `false` — it's the one value in the language that fails a self-comparison. Use `Number.isNaN(x)` to actually test for it.
- **Hoisting varies by declaration kind.** A `function` declaration is fully hoisted — callable before the line it's written on. `var` is hoisted but stays `undefined` until its line runs. `let`/`const` are hoisted into a "temporal dead zone" — referencing them before their line throws, rather than reading as `undefined`.
- **A closure remembers where it was born.** A function keeps access to the variables from its enclosing scope even after that outer function has already returned — the mechanism behind counters, memoization, and most "private state" patterns in JS.

## A few more gotchas

- **`typeof null` is `'object'`** — a decades-old bug in the language that shipped too early to ever fix without breaking the web. Checking `x === null` directly is the reliable way to test for it; `typeof` alone can't tell it apart from a real object.
- **`const` prevents reassignment, not mutation.** `const arr = [1, 2]; arr.push(3);` is completely legal — `const` only locks the *binding* (you can't point `arr` at a different array), not the contents of whatever it's pointing at.
- **`this` depends on how a function is called, except in an arrow function.** A regular function's `this` is set by its call site (`obj.method()` vs. a bare `method()` can give the same function a different `this`); an arrow function has no `this` of its own at all — it always uses whatever `this` was in scope where the arrow was written, which is exactly why arrow functions are the common fix for `this` getting "lost" inside a callback.
- **Equality has a third option most code never needs.** Beyond `==` (coercing) and `===` (strict), `Object.is(x, y)` is stricter still on two edge cases: `Object.is(NaN, NaN)` is `true` (unlike `===`), and `Object.is(0, -0)` is `false` (unlike `===`, which treats them as equal).
- **The event loop runs microtasks before the next macrotask.** A resolved `Promise`'s `.then()` callback (a microtask) always runs before the next `setTimeout` callback (a macrotask), even a `setTimeout(fn, 0)` — a common source of "why did this run in an order I didn't expect."

## Example

```javascript
function makeCounter() {
  let count = 0;
  return () => ++count; // closure: still sees `count` after makeCounter returns
}

const next = makeCounter();
next(); // 1
next(); // 2

'5' == 5;  // true  — coerced
'5' === 5; // false — not coerced

typeof null; // 'object' — the old bug, not a real object

const config = { host: 'bifrost.local', port: 4646 };
const { host, ...rest } = config; // destructuring + rest
console.log(host, rest); // 'bifrost.local' { port: 4646 }
```
