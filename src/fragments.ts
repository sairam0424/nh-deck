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
 * resolveMarkersInArray above: a fragment marker nested directly inside a
 * list item's own `.tokens` array -- the ONLY way CommonMark lets a
 * marker bind to ONE specific bullet without splitting the enclosing list
 * into two separate `<ul>`/`<ol>` tokens (verified directly against
 * marked's own lexer output; an unindented marker between two list items
 * with no blank line, or with one, both terminate the list instead) --
 * marks the WHOLE bullet (`<li>`), not whichever bare, unwrapped "text"/
 * "paragraph" token happens to be that item's own content. Only a
 * TRAILING marker (the last non-space entry in the item's own tokens)
 * bubbles up this way; a marker anywhere else inside the item (e.g.
 * between its own text and a nested sub-list) falls through to the
 * generic sibling-based resolution instead, which -- per
 * FRAGMENT_TARGET_TYPES -- has no supported target for that shape and
 * drops it with no visual effect rather than guessing.
 */
function transformListItem(
	listItem: Record<string, unknown>,
	onFragmentFound: () => void,
): Record<string, unknown> {
	const rawTokens = listItem.tokens as unknown[];
	const transformedTokens = rawTokens.map((child) =>
		transformNode(child, onFragmentFound),
	);

	const lastIndex = lastNonSpaceIndex(transformedTokens);
	const hasTrailingMarker =
		lastIndex !== -1 && isFragmentMarkerToken(transformedTokens[lastIndex]);

	const otherEntries = Object.entries(listItem)
		.filter(([key]) => key !== "tokens")
		.map(
			([key, value]) => [key, transformNode(value, onFragmentFound)] as const,
		);
	const otherFields = Object.fromEntries(otherEntries);

	if (!hasTrailingMarker) {
		return {
			...otherFields,
			tokens: resolveMarkersInArray(transformedTokens, onFragmentFound),
		};
	}

	onFragmentFound();
	const newTokens = [
		...transformedTokens.slice(0, lastIndex),
		...transformedTokens.slice(lastIndex + 1),
	];
	// The trailing marker above is only ONE marker this list item's own
	// tokens might contain -- an earlier direct marker (e.g. two paragraphs
	// in one bullet, the first followed by its own marker, the second being
	// this trailing one) would otherwise survive untouched and leak through
	// as a literal HTML comment inside the rendered <li>, since only
	// transformNode (not the sibling-relative resolveMarkersInArray) has
	// run over transformedTokens so far. Resolving again here removes it,
	// mirroring what the !hasTrailingMarker branch above already does.
	return {
		...otherFields,
		tokens: resolveMarkersInArray(newTokens, onFragmentFound),
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
	if (obj.type === "list_item" && Array.isArray(obj.tokens)) {
		return transformListItem(obj, onFragmentFound);
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
