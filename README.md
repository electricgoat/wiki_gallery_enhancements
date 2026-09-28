# Gallery enhancements

Gadgets that extend MediaWiki galleries on [Blue Archive Wiki](https://bluearchive.wiki).

## Gallery backgrounds

[gadgets/GalleryBackgrounds.js](gadgets/GalleryBackgrounds.js) and [gadgets/GalleryBackgrounds.css](gadgets/GalleryBackgrounds.css)

Shows sprites against the background they are meant to be seen on:

- Gallery thumbnails get a faint (20% opacity) copy of the background behind them.
- Media Viewer gets a **Background** toggle, left of **More details**, that puts the full background behind the image. It is off until a reader turns it on, and the choice is remembered in the browser. The toggle only appears for images that have a background.

### Wikitext

Name the background file in a `data-bg` attribute on the gallery:

```wikitext
<gallery data-bg="BG_GehennaCampus_Night.jpg">
Kayoko_(New_Year)_00.png
Kayoko_(New_Year)_01.png
</gallery>
```

- The `File:` prefix is optional, and spaces or underscores both work. File redirects are followed.
- `data-bg` can also go on any element around the gallery. It then applies to every gallery inside it. It also covers standalone images inside it, but only in the viewer.
- Full upload URLs work too, so `<div data-bg="{{filepath:BG_GehennaCampus_Night.jpg}}">` wrappers keep working.

**Why a file name rather than `{{filepath:}}`.** MediaWiki never expands templates or parser functions in extension-tag attributes, so `<gallery data-bg="{{filepath:X}}">` passes on the literal text. `data-*` attributes do survive onto the rendered `<ul class="gallery">`, so the gadget reads the file name and looks up the URLs with one batched `prop=imageinfo` request. That gives a 320px thumbnail for the gallery and a 1920px version for the viewer (or the original, if smaller). Some `BG_` originals are as large as 6150px / 3.6 MB.

The alternative is `{{#tag:gallery|…|data-bg={{filepath:X}}}}`, which does expand the attribute but forces every `|` in the gallery lines to be written as `{{!}}`.

### Installing

1. Copy the two files to `MediaWiki:Gadget-GalleryBackgrounds.js` and `MediaWiki:Gadget-GalleryBackgrounds.css`.
2. Add this line to `MediaWiki:Gadgets-definition`:

   ```
   * GalleryBackgrounds[ResourceLoader|default|hidden|dependencies=mediawiki.api,mediawiki.Title,mediawiki.storage]|GalleryBackgrounds.js|GalleryBackgrounds.css
   ```

   Drop `hidden` to let users turn it off in Special:Preferences.

To try it before deploying, put the files in your user space and load them from `Special:MyPage/common.js`:

```js
mw.loader.load( '/wiki/User:Electricsheep/GalleryBackgrounds.js?action=raw&ctype=text/javascript' );
mw.loader.load( '/wiki/User:Electricsheep/GalleryBackgrounds.css?action=raw&ctype=text/css', 'text/css' );
```

The script loads its own dependencies, so it works the same both ways.

### Settings

At the top of the JS:

- `VIEWER_DEFAULT` turns the viewer background on by default for readers who have not used the toggle yet.
- `THUMB_WIDTH` and `VIEWER_WIDTH` set the background sizes requested from the API.
- `MSG` holds the button label and tooltips.

In the CSS, the thumbnail opacity is on `.gallery-bg-thumb`.

### Media Viewer internals it relies on

- The `mmv-metadata`, `mmv-setup-overlay` and `mmv-cleanup-overlay` document events.
- A wrapper around `MultimediaViewer.prototype.loadImage`, so the background changes as soon as an image opens rather than after its details load. It is only installed on pages that use `data-bg`. If a Media Viewer update removes the method, backgrounds still work, just a moment later.
- The `.mw-mmv-image-wrapper` and `.mw-mmv-stripe-button-container` elements.

Background layers carry `mw-no-invert`, so the DarkMode extension's inverted page shows them in their real colours. The toggle is styled to match **More details** in Vector, Vector 2022 and Citizen.
