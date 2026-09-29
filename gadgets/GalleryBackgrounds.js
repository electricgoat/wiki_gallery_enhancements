/**
 * Gallery backgrounds
 *
 * Shows sprites against the background they are meant to be seen on:
 *
 *   <gallery data-bg="BG Gehenna Collection.png">
 *   Kayoko_(New_Year)_00.png
 *   Kayoko_(New_Year)_01.png
 *   </gallery>
 *
 * - Gallery thumbnails get a faint copy of the background behind them.
 * - Media Viewer gets a "Background" toggle, left of "More details", that puts the
 *   background behind the full-size image. The reader's choice is remembered.
 *   The background blurs while the mouse is over the image (GalleryBackgrounds.css).
 *
 * data-bg holds a file name ("File:" optional). A data-bg on one of the gallery's
 * li.gallerybox items overrides the gallery's for that image; an empty one removes it.
 *
 * Sprites (images with a background, or in a gallery with the "spritegallery" class) keep
 * a small margin from the edges of the viewer, where other images fill it.
 */
mw.loader.using( [ 'mediawiki.api', 'mediawiki.Title', 'mediawiki.storage' ] ).then( ( require ) => {
	'use strict';

	// Gallery thumbnails get a scaled-down background; the viewer uses the original
	const THUMB_WIDTH = 320;
	// Space kept between a sprite and the edges of the viewer, in pixels
	const SPRITE_MARGIN = 8;
	// Whether the viewer shows backgrounds for readers who have not used the toggle yet
	const VIEWER_DEFAULT = false;
	const STORAGE_KEY = 'gallery-bg-viewer';
	const MSG = {
		label: 'Background',
		show: 'Show the background',
		hide: 'Hide the background'
	};

	const api = new mw.Api();
	// "File:Title" -> Promise of { thumb, full } URLs, or null if there is no such file
	const imageCache = new Map();

	const stored = mw.storage.get( STORAGE_KEY );
	let viewerOn = stored === '1' || ( stored !== '0' && VIEWER_DEFAULT );
	let viewerPatched = false;
	// What the viewer is showing: its injected elements, and the current image's background
	const viewer = { ui: null, title: null, url: null };

	/**
	 * @param {string} url
	 * @return {string} CSS url() value
	 */
	function cssUrl( url ) {
		return 'url("' + url.replace( /["\\\n\r\f]/g, ( c ) => '\\' + c.charCodeAt( 0 ).toString( 16 ) + ' ' ) + '")';
	}

	/**
	 * Find the background file for an element from the nearest data-bg attribute:
	 * the gallery box's own if it has one, otherwise the gallery's.
	 *
	 * @param {Element} el
	 * @return {string|null} Prefixed title, e.g. "File:BG Gehenna Collection.png"
	 */
	function getBgTitle( el ) {
		const source = el.closest( '[data-bg]' );
		const title = source && mw.Title.newFromText( source.getAttribute( 'data-bg' ).trim(), 6 );
		return title && title.getNamespaceId() === 6 ? title.getPrefixedText() : null;
	}

	/**
	 * @param {Object} image Media Viewer's LightboxImage
	 * @return {boolean} Whether the image is a sprite: it has a background, or its gallery is a sprite gallery
	 */
	function isSprite( image ) {
		const el = image && image.thumbnail;
		return !!el && ( !!el.closest( 'ul.gallery.spritegallery' ) || !!getBgTitle( el ) );
	}

	/**
	 * @param {Object} data API response
	 * @param {string[]} titles Titles that were requested
	 * @return {Object} { thumb, full } URLs (or null) for each requested title
	 */
	function imagesFromResponse( data, titles ) {
		const query = data.query || {};
		const renamed = {};
		( query.normalized || [] ).concat( query.redirects || [] ).forEach( ( r ) => {
			renamed[ r.from ] = r.to;
		} );
		const found = {};
		( query.pages || [] ).forEach( ( page ) => {
			const info = page.imageinfo && page.imageinfo[ 0 ];
			if ( info ) {
				found[ page.title ] = { thumb: info.thumburl || info.url, full: info.url };
			}
		} );
		const images = {};
		titles.forEach( ( title ) => {
			// At most a normalisation followed by a redirect
			let target = title;
			for ( let i = 0; i < 3 && renamed[ target ]; i++ ) {
				target = renamed[ target ];
			}
			images[ title ] = found[ target ] || null;
			if ( !images[ title ] ) {
				mw.log.warn( 'GalleryBackgrounds: no image found for ' + title );
			}
		} );
		return images;
	}

	/**
	 * Look up background files, 50 titles per request, caching the answers.
	 *
	 * @param {string[]} titles
	 * @return {Promise<Array<Object|null>>} { thumb, full } URLs for each title, in the same order
	 */
	function getImages( titles ) {
		const todo = Array.from( new Set( titles ) ).filter( ( t ) => !imageCache.has( t ) );
		for ( let i = 0; i < todo.length; i += 50 ) {
			const batch = todo.slice( i, i + 50 );
			const request = Promise.resolve( api.get( {
				action: 'query',
				prop: 'imageinfo',
				iiprop: 'url',
				iiurlwidth: THUMB_WIDTH,
				titles: batch,
				redirects: true,
				formatversion: 2,
				maxage: 86400,
				smaxage: 86400
			} ) ).then( ( data ) => imagesFromResponse( data, batch ), ( code ) => {
				mw.log.warn( 'GalleryBackgrounds: image lookup failed: ' + code );
				return {};
			} );
			batch.forEach( ( t ) => {
				imageCache.set( t, request.then( ( images ) => images[ t ] || null ) );
			} );
		}
		return Promise.all( titles.map( ( t ) => imageCache.get( t ) ) );
	}

	/**
	 * @param {HTMLElement} box li.gallerybox
	 * @param {string} url Thumbnail-sized background
	 */
	function decorateBox( box, url ) {
		const thumb = box.querySelector( ':scope > .thumb' );
		if ( !thumb ) {
			return;
		}
		box.classList.add( 'gallery-bg' );
		box.style.setProperty( '--gallery-bg-image', cssUrl( url ) );
		if ( !thumb.querySelector( ':scope > .gallery-bg-thumb' ) ) {
			const layer = document.createElement( 'span' );
			// mw-no-invert keeps the picture's colours under the DarkMode extension's inverted page
			layer.className = 'gallery-bg-thumb mw-no-invert';
			thumb.insertBefore( layer, thumb.firstChild );
		}
		// Hook into the viewer before a click on this image opens it
		box.addEventListener( 'pointerover', patchViewer, { once: true } );
		box.addEventListener( 'focusin', patchViewer, { once: true } );
	}

	/**
	 * @param {jQuery} $content
	 */
	function decorateGalleries( $content ) {
		const boxes = [];
		$content.find( 'ul.gallery > li.gallerybox' ).each( ( i, box ) => {
			const title = getBgTitle( box );
			if ( title ) {
				boxes.push( { box, title } );
			}
		} );
		if ( boxes.length ) {
			getImages( boxes.map( ( b ) => b.title ) ).then( ( images ) => {
				boxes.forEach( ( b, i ) => {
					if ( images[ i ] ) {
						decorateBox( b.box, images[ i ].thumb );
					}
				} );
			} );
		}
	}

	/**
	 * Add the background layer and the toggle button to the viewer, once per viewer.
	 *
	 * @return {Object|null}
	 */
	function getViewerUi() {
		const wrapper = document.querySelector( '.mw-mmv-wrapper' );
		if ( !wrapper || ( viewer.ui && viewer.ui.wrapper === wrapper ) ) {
			return viewer.ui;
		}
		const canvas = wrapper.querySelector( '.mw-mmv-image-wrapper' );
		const buttons = wrapper.querySelector( '.mw-mmv-stripe-button-container' );
		if ( !canvas || !buttons ) {
			return viewer.ui;
		}

		const layer = document.createElement( 'div' );
		layer.className = 'gallery-bg-viewer mw-no-invert';
		canvas.insertBefore( layer, canvas.firstChild );

		const icon = document.createElement( 'span' );
		icon.className = 'cdx-button__icon';
		icon.setAttribute( 'aria-hidden', 'true' );
		const label = document.createElement( 'span' );
		label.className = 'gallery-bg-toggle-label';
		label.textContent = MSG.label;
		const button = document.createElement( 'button' );
		button.type = 'button';
		button.className = 'mw-mmv-stripe-button cdx-button cdx-button--size-large gallery-bg-toggle';
		button.append( icon, label );
		button.addEventListener( 'click', () => {
			viewerOn = !viewerOn;
			mw.storage.set( STORAGE_KEY, viewerOn ? '1' : '0' );
			renderViewer();
		} );
		// Stripe buttons float right, so appending puts this one left of "More details"
		buttons.appendChild( button );

		viewer.ui = { wrapper, layer, button, layerUrl: null };
		return viewer.ui;
	}

	function renderViewer() {
		const ui = viewer.ui;
		if ( !ui ) {
			return;
		}
		const show = viewerOn && !!viewer.url;
		ui.button.classList.toggle( 'gallery-bg-toggle-hidden', !viewer.url );
		ui.button.classList.toggle( 'cdx-button--action-progressive', viewerOn );
		ui.button.setAttribute( 'aria-pressed', String( viewerOn ) );
		ui.button.title = viewerOn ? MSG.hide : MSG.show;
		ui.wrapper.classList.toggle( 'gallery-bg-viewer-on', show );

		if ( show && ui.layerUrl !== viewer.url ) {
			const url = viewer.url;
			ui.layerUrl = url;
			ui.layer.classList.remove( 'gallery-bg-loaded' );
			ui.layer.style.setProperty( '--gallery-bg-image', cssUrl( url ) );
			// Fade in once loaded rather than painting a half-loaded picture
			const img = new Image();
			img.onload = () => {
				if ( ui.layerUrl === url ) {
					ui.layer.classList.add( 'gallery-bg-loaded' );
				}
			};
			img.src = url;
		}
	}

	/**
	 * Update the viewer for the image it is now showing.
	 *
	 * @param {Object|null} image Media Viewer's LightboxImage, null when it closes
	 */
	function showInViewer( image ) {
		const title = image && image.thumbnail ? getBgTitle( image.thumbnail ) : null;
		// Leave the viewer untouched until there is a background to offer
		if ( !title && !viewer.ui ) {
			return;
		}
		getViewerUi();
		if ( title !== viewer.title ) {
			viewer.title = title;
			viewer.url = null;
			if ( title ) {
				// Already looked up for the gallery, unless the image is outside one
				getImages( [ title ] ).then( ( images ) => {
					if ( viewer.title === title ) {
						viewer.url = images[ 0 ] && images[ 0 ].full;
						renderViewer();
					}
				} );
			}
		}
		renderViewer();
	}

	/**
	 * Hook Media Viewer:
	 * - The method that opens an image, to switch backgrounds as soon as an image is opened.
	 *   Media Viewer only reports an image once it and its details have loaded (mmv-metadata).
	 * - The method that sizes images for the canvas, to keep sprites off its edges.
	 *
	 * @param {Object} mmv Exports of the mmv module
	 */
	function patchModule( mmv ) {
		const MultimediaViewer = mmv.MultimediaViewer;
		const loadImage = MultimediaViewer && MultimediaViewer.prototype.loadImage;
		if ( typeof loadImage === 'function' ) {
			MultimediaViewer.prototype.loadImage = function ( image ) {
				const result = loadImage.apply( this, arguments );
				try {
					showInViewer( image );
				} catch ( e ) {
					mw.log.error( e );
				}
				return result;
			};
		}

		const Canvas = mmv.Canvas;
		const getWidths = Canvas && Canvas.prototype.getLightboxImageWidths;
		if ( typeof getWidths === 'function' ) {
			Canvas.prototype.getLightboxImageWidths = function ( image ) {
				const calculator = this.thumbnailWidthCalculator;
				if ( !isSprite( image ) || !calculator || typeof this.getDimensions !== 'function' ) {
					return getWidths.apply( this, arguments );
				}
				// As Media Viewer's own, but fitting the image inside the margin
				const canvas = this.getDimensions();
				return calculator.calculateWidths(
					Math.max( 1, canvas.width - 2 * SPRITE_MARGIN ),
					Math.max( 1, canvas.height - 2 * SPRITE_MARGIN ),
					image.originalWidth || image.thumbnail.width,
					image.originalHeight || image.thumbnail.height
				);
			};
		}
	}

	function patchViewer() {
		if ( viewerPatched || !mw.loader.getState( 'mmv' ) || !document.querySelector( '[data-bg], ul.gallery.spritegallery' ) ) {
			return;
		}
		viewerPatched = true;
		if ( mw.loader.getState( 'mmv' ) === 'ready' ) {
			// Right away when the viewer is opening (mmv-setup-overlay), so the image
			// it is opening is sized with the patch too
			patchModule( require( 'mmv' ) );
		} else {
			mw.loader.using( 'mmv' ).then( ( req ) => patchModule( req( 'mmv' ) ) );
		}
	}

	mw.hook( 'wikipage.content' ).add( decorateGalleries );
	$( document )
		.on( 'mmv-setup-overlay', patchViewer )
		.on( 'mmv-metadata', ( e ) => {
			// Media Viewer also reports images whose details arrive after another was opened
			if ( !e.viewer || ( e.viewer.isOpen && e.viewer.currentImage === e.image ) ) {
				showInViewer( e.image );
			}
		} )
		.on( 'mmv-cleanup-overlay', () => showInViewer( null ) );
} );
