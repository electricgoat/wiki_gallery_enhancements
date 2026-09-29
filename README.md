# Gallery enhancements

Gadgets that extend MediaWiki galleries and Media Viewer on [Blue Archive Wiki](https://bluearchive.wiki).

They work wherever Media Viewer does, in every skin including Minerva used as a desktop skin. MobileFrontend's mobile view has its own image viewer, which isn't supported, because MobileFrontend is to be removed after the move to Citizen. In mobile view, only the gallery thumbnail backgrounds appear.

## Gallery backgrounds

[gadgets/GalleryBackgrounds.js](gadgets/GalleryBackgrounds.js) and [gadgets/GalleryBackgrounds.css](gadgets/GalleryBackgrounds.css)

Shows sprites against the background they are meant to be seen on:

- Gallery thumbnails get a faint (20% opacity) copy of the background behind them.
- An image counts as a sprite if it has a background, or if its gallery has the `spritegallery` class. For sprites, Media Viewer gets a **Background** toggle, left of **More details**.
  - On, it shows the sprite's background. That's the full background image if it has one, otherwise Media Viewer's transparency checkerboard.
  - Off, the sprite sits on the viewer's plain dark canvas, with no checkerboard.
  - It is off until a reader turns it on, and the one choice applies to all sprites and is remembered in the browser. Other images keep their usual look and get no toggle.
- While the mouse is over the image, the viewer background blurs with a slow (0.8s) transition, which brings the sprite forward. This is plain CSS and only applies on devices with a mouse.
- Sprites keep an 8px margin from the edges of the viewer, where other images fill it. The margin applies whether or not the background is showing, so the sprite doesn't change size when you toggle it.
- Media Viewer's backdrop is a dark grey (`#1a1a1a`) instead of black, for every image, sprite or not. Citizen's pure black theme keeps black.

### Wikitext

`data-bg` holds a file name. Put it on the gallery to give every image in it a background:

```wikitext
<gallery data-bg="BG_Gehenna_Collection.png">
Erika_00.png
Erika_01.png
</gallery>
```

For a single image, put it on the image's `li.gallerybox`. It overrides the gallery's background, and an empty `data-bg=""` removes it for that image:

```html
<li class="gallerybox" style="width: 155px" data-bg="BG Gehenna Collection.png">
```

`<gallery>` lines can't set attributes on their `li`: `File.png|data-bg=…` becomes a caption. So per-image backgrounds need a template that builds the gallery markup itself, like `{{SpriteGallery}}` on [Erika](https://bluearchive.wiki/wiki/Erika#Sprites). [Erika/gallery](https://bluearchive.wiki/wiki/Erika/gallery) shows the gallery-level form.

- The `File:` prefix is optional, and spaces or underscores both work. File redirects are followed.
- Use the 1024×768 collection backgrounds (`BG_…_Collection.png`). The viewer shows the original file, and some `BG_` scene files are as large as 6150px / 3.6 MB.
- To make a gallery without a background image count as sprites, add the class: `<gallery class="spritegallery">`. A template that builds the markup itself can put it on the `ul.gallery`, as `{{SpriteGallery}}` does. Its sprites get the margin, and the toggle switches the checkerboard.

The gadget looks up every background on the page in one API request, which returns a 320px version for the gallery thumbnails and the original for the viewer. The attribute takes a file name rather than `{{filepath:}}` because MediaWiki doesn't expand templates in `<gallery>` attributes.

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
- `THUMB_WIDTH` sets the size of the thumbnail backgrounds.
- `SPRITE_MARGIN` sets the space around sprites in the viewer, in pixels.
- `MSG` holds the button label and tooltips.

In the CSS:

- The thumbnail opacity is on `.gallery-bg-thumb`.
- The viewer backdrop colour is `--gallery-bg-viewer-backdrop` on `:root`. It is set to `#000` for Citizen's pure black theme, whether chosen directly or through the automatic theme in system dark mode.
- The blur radius is `--gallery-bg-blur` on `.gallery-bg-viewer`.
- The blur's transition time is on `.gallery-bg-viewer::before`.

### Media Viewer internals it relies on

- The `mmv-metadata`, `mmv-setup-overlay` and `mmv-cleanup-overlay` document events. `mmv-metadata` also fires for an image whose details arrive after another image was opened, so the gadget only acts on it for the viewer's current image.
- A wrapper around `Canvas.prototype.set`, which puts each new image on the canvas. The background, checkerboard and toggle are set before the image appears, including the first image the viewer opens. If a Media Viewer update removes the method, the `mmv-metadata` event still updates them, just a moment later.
- A wrapper around `Canvas.prototype.getLightboxImageWidths`, the one place Media Viewer sizes images for its canvas. For sprites, it fits the image to a canvas `SPRITE_MARGIN` smaller on each side. The placeholder, the final image, preloading, window resizes and fullscreen all go through it, so they stay consistent.
- Both wrappers are only installed on pages with `data-bg` or a `spritegallery`. They go in as the viewer opens (`mmv-setup-overlay`), before it sizes and shows the first image.
- The checkerboard is Media Viewer's own `background: url(…/checker.png)` on PNG, GIF, WebP, SVG and TIFF images. The gadget only removes it (the `gallery-bg-no-checker` class), so it looks exactly as usual when shown.
- The `.mw-mmv-image-wrapper` and `.mw-mmv-stripe-button-container` elements. The blur is a `:has( .mw-mmv-image img:hover )` rule on the image wrapper.

Background layers carry `mw-no-invert`, so the DarkMode extension's inverted page shows them in their real colours. The toggle is styled to match **More details** in Vector, Vector 2022 and Citizen.

## Media Viewer paging

[gadgets/MediaViewerPaging.js](gadgets/MediaViewerPaging.js) and [gadgets/MediaViewerPaging.css](gadgets/MediaViewerPaging.css)

Removes the flicker when paging through images in Media Viewer, and preloads the previous image as well as the next.

When you page, Media Viewer shows the page's gallery thumbnail at its own small size (about 50×120 for a sprite) for a frame or more before the real image appears. This happens even when the image was preloaded. Three things cause it:

- `loadImage` hides the placeholder with `.hide().removeAttr( 'style' )`, and the second call undoes the first.
- It only sizes the placeholder while its `realThumbnailShown` flag is false, but it checks the flag before resetting it for the new image. After the first image, placeholders therefore stay at thumbnail size.
- A preloaded image still reaches the screen through an asynchronous promise, so the placeholder gets painted first.

The gadget works around all three:

- An image Media Viewer has already loaded is shown straight away, with no placeholder.
- Otherwise the placeholder is sized as Media Viewer intends: full size, blurry until the real image arrives. Placeholders that were never sized stay hidden.
- The previous image and its details are preloaded. Media Viewer itself only preloads the next one.

### Installing

Copy the files to `MediaWiki:Gadget-MediaViewerPaging.js` and `.css`, and add:

```
* MediaViewerPaging[ResourceLoader|default|hidden]|MediaViewerPaging.js|MediaViewerPaging.css
```

It works on every page that uses Media Viewer and doesn't depend on Gallery backgrounds. Both gadgets wrap the same Media Viewer method and work together in either load order.

### Media Viewer internals it relies on

- A wrapper around `MultimediaViewer.prototype.loadImage`, installed when the viewer first opens (`mmv-setup-overlay`).
- The viewer's `thumbnailInfoProvider` and `imageProvider` caches, plus its `setImage`, `displayPlaceholderThumbnail`, `fetchThumbnail`, `fetchSizeIndependentLightboxInfo` and `ui.canvas`.
- The `mmv-metadata` event for preloading.

Every step is guarded. If an update changes these, the gadget stops acting and the viewer works as it does without it. The two placeholder bugs are worth reporting upstream on Phabricator (MultimediaViewer), so the gadget can eventually be retired.
