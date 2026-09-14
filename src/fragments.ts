import type { Token } from "marked";

const FRAGMENT_MARKER_PATTERN = /^<!--\s*fragment\s*-->/i;

/**
 * Token types whose renderer override (see render.ts's marked.use({
 * renderer: {...} }) call) actually composes `class="fragment"` into its
 * rendered output -- paragraph, list_item, blockquote, and code (which
 * covers both a plain fenced code block and a Mermaid diagram, since a
 * Mermaid block is just a "code" token with `lang: "mermaid"`). These are
 * exactly the categories named in the authoring convention this module
 * implements: "immediately following a bullet/list-item or paragraph ...
 * or preceding a block element like a code fence/Mermaid diagram/
 * blockquote". A marker that ends up adjacent to anything outside this
 * set (a heading, a whole list as opposed to one of its items, a table,
 * ...) is dropped with no visual effect rather than setting a `fragment`
 * flag nothing would ever render -- see resolveMarkersInArray below.
 */
const FRAGMENT_TARGET_TYPES = new Set([
	"paragraph",
	"list_item",
	"blockquote",
	"code",
]);

/**
 * Returns true if `text` is (the start of) a standalone `<!-- fragment -->`
 * HTML comment -- the single-word marker this module recognizes,
 * case-insensitively and tolerant of extra internal whitespace (e.g.
 * `<!--fragment-->`, `<!-- FRAGMENT -->`). Deliberately NOT the generic
 * "any HTML comment" pattern presenterNotes.ts's isPresenterNoteComment
 * uses -- a fragment marker must be disambiguated from an ordinary
 * presenter note or a `<!-- layout: name -->` marker by its own specific
 * content, not merely by being comment-shaped. Shared with render.ts's
 * containsUnsafeHtml the same way isPresenterNoteComment already is, so a
 * fragment-marked deck never trips that unsafe-HTML warning.
 */
export function isFragmentMarkerComment(text: string): boolean {
	return FRAGMENT_MARKER_PATTERN.test(text);
}

function isTokenLike(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function tokenType(value: unknown): string | undefined {
	return isTokenLike(value) && typeof value.type === "string"
		? value.type
		: undefined;
}

function isSpaceToken(value: unknown): boolean {
	return tokenType(value) === "space";
}

function isFragmentMarkerToken(value: unknown): boolean {
	if (!isTokenLike(value) || value.type !== "html") {
		return false;
	}
	return typeof value.text === "string" && isFragmentMarkerComment(value.text);
}

function isValidFragmentTarget(value: unknown): boolean {
	const type = tokenType(value);
	return type !== undefined && FRAGMENT_TARGET_TYPES.has(type);
}

function withFragmentFlag(value: unknown): unknown {
	return isTokenLike(value) ? { ...value, fragment: true } : value;
}

function isSkippableDuringScan(value: unknown): boolean {
	return isSpaceToken(value) || isFragmentMarkerToken(value);
}

function nextContentIndex(items: unknown[], fromIndex: number): number {
	let i = fromIndex;
	while (i < items.length && isSkippableDuringScan(items[i])) {
		i++;
	}
	return i < items.length ? i : -1;
}

function previousContentIndex(items: unknown[], fromIndex: number): number {
	let i = fromIndex;
	while (i >= 0 && isSkippableDuringScan(items[i])) {
		i--;
	}
	return i >= 0 ? i : -1;
}

function lastNonSpaceIndex(items: unknown[]): number {
	let i = items.length - 1;
	while (i >= 0 && isSpaceToken(items[i])) {
		i--;
	}
	return i;
}

/**
 * Block-level token types whose OWN `.tokens` is that token's inline
 * content (not further block-level children) -- the wrapper shapes
 * marked's lexer produces for a single line of text with nothing else
 * around it: "paragraph" for a loose list item or a top-level paragraph,
 * "text" for a tight list item specifically. extractOwnTrailingMarker
 * below drills exactly one level into either shape looking for a marker
 * nested inside it; recursion stops naturally past that because a plain
 * inline token (the actual text run) has no `.tokens` array of its own.
 */
const WRAPPED_INLINE_CONTENT_TYPES = new Set(["paragraph", "text"]);

/**
 * Detects and strips a fragment marker that marks a self-contained
 * content unit (a list item, or a top-level paragraph) AS A WHOLE,
 * checked on the RAW tokens before any recursive transform could
 * otherwise reach and silently drop the marker. Handles two shapes:
 *
 * Shape 1 -- marker on its own separate line: a direct sibling, the last
 * non-space entry in `items` itself (e.g. "- Item 1\n  <!-- fragment
 * -->\n", or "First.\n\n<!-- fragment -->\n\nSecond.").
 *
 * Shape 2 -- marker trailing on the SAME line as the unit's own text
 * (e.g. "- Item 1 <!-- fragment -->\n", or "First. <!-- fragment -->\n\n
 * Second."): marked's lexer wraps a single line of content in one extra
 * block token (see WRAPPED_INLINE_CONTENT_TYPES) whose OWN inline
 * `.tokens` is `[...text, marker]` -- one level deeper than Shape 1. A
 * multi-paragraph list item's LAST paragraph ending in a same-line marker
 * reaches this same check too, since that paragraph is itself the last
 * entry in `items` -- which is why it correctly marks the whole item
 * rather than just that trailing paragraph.
 *
 * Returns the marker removed from wherever it was actually found (Shape 1
 * removes it from `items` directly; Shape 2 rebuilds only the one nested
 * wrapper token, immutably, leaving every sibling untouched) alongside
 * whether one was found at all.
 */
function extractOwnTrailingMarker(items: unknown[]): {
	tokens: unknown[];
	foundTrailingMarker: boolean;
} {
	const lastIndex = lastNonSpaceIndex(items);
	if (lastIndex === -1) {
		return { tokens: items, foundTrailingMarker: false };
	}

	if (isFragmentMarkerToken(items[lastIndex])) {
		return {
			tokens: [...items.slice(0, lastIndex), ...items.slice(lastIndex + 1)],
			foundTrailingMarker: true,
		};
	}

	const lastEntry = items[lastIndex];
	const lastEntryType = tokenType(lastEntry);
	if (
		lastEntryType !== undefined &&
		WRAPPED_INLINE_CONTENT_TYPES.has(lastEntryType) &&
		isTokenLike(lastEntry) &&
		Array.isArray(lastEntry.tokens)
	) {
		const inner = extractOwnTrailingMarker(lastEntry.tokens);
		if (inner.foundTrailingMarker) {
			const updatedLastEntry = { ...lastEntry, tokens: inner.tokens };
			const newItems = [...items];
			newItems[lastIndex] = updatedLastEntry;
			return { tokens: newItems, foundTrailingMarker: true };
		}
	}

	return { tokens: items, foundTrailingMarker: false };
}

/**
 * Resolves every fragment marker found directly inside `items` (already
 * recursively transformed by transformNode below) by flagging the nearest
 * adjacent sibling within this SAME array, then returns a new array with
 * every marker removed. Two conventions, checked in this order for each
 * marker:
 *
 * 1. "preceding a block element like a code fence/Mermaid diagram/
 *    blockquote" -- if the next non-space, non-marker sibling is a
 *    "code" or "blockquote" token, that sibling is flagged regardless of
 *    what (if anything) precedes the marker.
 * 2. "following a bullet/list-item or paragraph" -- otherwise, the
 *    nearest PRECEDING non-space, non-marker sibling is flagged, as long
 *    as it's one of FRAGMENT_TARGET_TYPES.
 * 3. As a last resort (no valid preceding sibling), the nearest
 *    FOLLOWING sibling is flagged instead, again only if it's a
 *    supported type.
 *
 * A marker with no supported adjacent sibling under any of the above
 * (e.g. one sitting between two headings, or immediately after an
 * un-nested whole list rather than one of its own items) is simply
 * dropped -- see FRAGMENT_TARGET_TYPES's own docstring.
 */
function resolveMarkersInArray(
	items: unknown[],
	onFragmentFound: () => void,
): unknown[] {
	const markerIndices = new Set<number>();
	for (let i = 0; i < items.length; i++) {
		if (isFragmentMarkerToken(items[i])) {
			markerIndices.add(i);
		}
	}
	if (markerIndices.size === 0) {
		return items;
	}

	const flaggedIndices = new Set<number>();
	for (const markerIndex of markerIndices) {
		const forwardIndex = nextContentIndex(items, markerIndex + 1);
		const forwardType =
			forwardIndex === -1 ? undefined : tokenType(items[forwardIndex]);
		if (
			forwardIndex !== -1 &&
			(forwardType === "code" || forwardType === "blockquote")
		) {
			flaggedIndices.add(forwardIndex);
			continue;
		}

		const backwardIndex = previousContentIndex(items, markerIndex - 1);
		if (backwardIndex !== -1 && isValidFragmentTarget(items[backwardIndex])) {
			flaggedIndices.add(backwardIndex);
		} else if (
			forwardIndex !== -1 &&
			isValidFragmentTarget(items[forwardIndex])
		) {
			flaggedIndices.add(forwardIndex);
		}
	}

	if (flaggedIndices.size > 0) {
		onFragmentFound();
	}

	const result: unknown[] = [];
	for (let i = 0; i < items.length; i++) {
		if (markerIndices.has(i)) {
			continue;
		}
		result.push(flaggedIndices.has(i) ? withFragmentFlag(items[i]) : items[i]);
	}
	return result;
}

/**
 * Special-cased ahead of (and instead of, when it applies) the generic
 * resolveMarkersInArray above: a fragment marker that marks a whole
 * self-contained content unit -- a list item, or a top-level paragraph --
 * rather than merely one of its siblings. For a list item, this is the
 * ONLY way CommonMark lets a marker bind to ONE specific bullet without
 * splitting the enclosing list into two separate `<ul>`/`<ol>` tokens
 * (verified directly against marked's own lexer output; an unindented
 * marker between two list items with no blank line, or with one, both
 * terminate the list instead) -- marks the WHOLE bullet (`<li>`), not
 * whichever bare, unwrapped "text"/"paragraph" token happens to be that
 * item's own content. For a top-level paragraph, this is simply "does
 * this paragraph's own trailing content end in a marker" -- see
 * extractOwnTrailingMarker's Shape 2 for why a SAME-LINE trailing marker
 * needs this dedicated check rather than the generic sibling-based
 * resolution below: the marker is nested one level inside the token's
 * own inline `.tokens`, not present as a direct sibling anywhere
 * resolveMarkersInArray would ever look.
 *
 * Only a TRAILING marker (the last non-space entry, checked via
 * extractOwnTrailingMarker on the RAW tokens before any recursive
 * transform could otherwise silently drop it) is resolved this way; a
 * marker anywhere else inside the token (e.g. between its own text and a
 * nested sub-list) falls through to the generic sibling-based resolution
 * instead, which -- per FRAGMENT_TARGET_TYPES -- has no supported target
 * for that shape and drops it with no visual effect rather than guessing.
 */
function transformSelfMarkableToken(
	token: Record<string, unknown>,
	onFragmentFound: () => void,
): Record<string, unknown> {
	const rawTokens = token.tokens as unknown[];
	const { tokens: tokensWithMarkerRemoved, foundTrailingMarker } =
		extractOwnTrailingMarker(rawTokens);
	const transformedTokens = tokensWithMarkerRemoved.map((child) =>
		transformNode(child, onFragmentFound),
	);

	const otherEntries = Object.entries(token)
		.filter(([key]) => key !== "tokens")
		.map(
			([key, value]) => [key, transformNode(value, onFragmentFound)] as const,
		);
	const otherFields = Object.fromEntries(otherEntries);

	if (!foundTrailingMarker) {
		return {
			...otherFields,
			tokens: resolveMarkersInArray(transformedTokens, onFragmentFound),
		};
	}

	onFragmentFound();
	// The trailing marker above is only ONE marker this token's own tokens
	// might contain -- an earlier direct marker (e.g. two paragraphs in one
	// list item, the first followed by its own marker, the second being
	// this trailing one) would otherwise survive untouched and leak through
	// as a literal HTML comment. Resolving again here removes it, mirroring
	// what the !foundTrailingMarker branch above already does.
	return {
		...otherFields,
		tokens: resolveMarkersInArray(transformedTokens, onFragmentFound),
		fragment: true,
	};
}

/**
 * Walks the entire token tree generically -- any array is walked
 * element-by-element, any object is walked property-by-property -- the
 * exact technique render.ts's containsUnsafeHtml already demonstrates for
 * walking nested tokens generically, extended here to REBUILD the tree
 * (immutably -- every array/object encountered is a freshly-constructed
 * copy, never the original mutated in place) rather than merely inspect
 * it. This is what lets a fragment marker bind correctly no matter how
 * deeply nested it is (inside a list item, inside a blockquote, ...),
 * unlike extractSlideLayout/extractNotes, which only ever scan a single
 * slide's TOP-LEVEL token array.
 *
 * "list_item" and "paragraph" both route through transformSelfMarkableToken
 * first -- see that function's own docstring for why a same-line trailing
 * marker needs a dedicated check rather than the generic sibling-based
 * resolveMarkersInArray call below, which only ever looks at DIRECT
 * siblings and would never find a marker nested one level inside either
 * token's own inline content.
 */
function transformNode(node: unknown, onFragmentFound: () => void): unknown {
	if (Array.isArray(node)) {
		const children = node.map((child) => transformNode(child, onFragmentFound));
		return resolveMarkersInArray(children, onFragmentFound);
	}
	if (node === null || typeof node !== "object") {
		return node;
	}
	const obj = node as Record<string, unknown>;
	if (
		(obj.type === "list_item" || obj.type === "paragraph") &&
		Array.isArray(obj.tokens)
	) {
		return transformSelfMarkableToken(obj, onFragmentFound);
	}
	const entries = Object.entries(obj).map(
		([key, value]) => [key, transformNode(value, onFragmentFound)] as const,
	);
	return Object.fromEntries(entries);
}

/**
 * Extracts `<!-- fragment -->` markers from one slide's token array,
 * returning a new token array with every marker removed and its target
 * element flagged (`fragment: true`) for render.ts's renderer overrides
 * to pick up, plus whether any marker actually found a target -- used by
 * generateHtml to decide whether this slide (and therefore the whole
 * deck) needs the reduced-motion accommodation for `.fragment`'s reveal
 * transition, the same way it already checks the rendered output for
 * `class="katex"` before paying KaTeX's own embedded-font cost.
 */
export function extractFragments(tokens: Token[]): {
	tokens: Token[];
	hasFragment: boolean;
} {
	let hasFragment = false;
	const onFragmentFound = () => {
		hasFragment = true;
	};
	const result = transformNode(tokens, onFragmentFound) as Token[];
	return { tokens: result, hasFragment };
}
