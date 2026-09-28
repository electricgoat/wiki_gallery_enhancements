/**
 * Gallery backgrounds
 *
 * Shows sprites against the background they are meant to be seen on:
 *
 *   <gallery data-bg="BG_GehennaCampus_Night.jpg">
 *   Kayoko_(New_Year)_00.png
 *   Kayoko_(New_Year)_01.png
 *   </gallery>
 *
 * - Gallery thumbnails get a faint copy of the background behind them.
 * - Media Viewer gets a "Background" toggle, left of "More details", that puts the
 *   background behind the full-size image. The reader's choice is remembered.
 *
 * data-bg takes a file name ("File:" optional) or an upload URL such as the output of
 * {{filepath:}}. It can also go on an element wrapping the gallery, and then applies to
 * every gallery and image inside that element.
 */
mw.loader.using( [ 'mediawiki.api', 'mediawiki.Title', 'mediawiki.storage' ] ).then( () => {
	'use strict';

	// Widths requested from the API: thumbnail backgrounds are small and faint,
	// the viewer's fills the window (originals smaller than this are used as they are).
	const THUMB_WIDTH = 320;
	const VIEWER_WIDTH = 1920;
	// Whether the viewer shows backgrounds for readers who have not used the toggle yet
	const VIEWER_DEFAULT = false;
	const STORAGE_KEY = 'gallery-bg-viewer';
	const MSG = {
		label: 'Background',
		show: 'Show the background',
		hide: 'Hide the background'
	};

	const api = new mw.Api();
	// "width|File:Title" -> Promise of the image URL, or null if there is no such file
	const urlCache = new Map();
	// Every background title seen on the page, so the viewer can fetch them in one request
	const pageTitles = new Set();

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
	 * Find the background file for an element from the nearest data-bg attribute.
	 *
	 * @param {Element} el
	 * @return {string|null} Prefixed title, e.g. "File:BG GehennaCampus Night.jpg"
	 */
	function getBgTitle( el ) {
		const source = el.closest( '[data-bg]' );
		let value = source ? source.getAttribute( 'data-bg' ).trim() : '';
		if ( /^(https?:)?\/\//i.test( value ) ) {
			// Upload URL: .../6/6c/Name.jpg, or .../thumb/6/6c/Name.jpg/320px-Name.jpg
			try {
				const parts = new URL( value, location.href ).pathname.split( '/' );
				value = decodeURIComponent( parts[ parts.length - ( parts.includes( 'thumb' ) ? 2 : 1 ) ] );
			} catch ( e ) {
				return null;
			}
		}
		const title = value ? mw.Title.newFromText( value, 6 ) : null;
		return title && title.getNamespaceId() === 6 ? title.getPrefixedText() : null;
	}

	/**
	 * @param {Object} data API response
	 * @param {string[]} titles Titles that were requested
	 * @return {Object} Image URL (or null) for each requested title
	 */
	function urlsFromResponse( data, titles ) {
		const query = data.query || {};
		const renamed = {};
		( query.normalized || [] ).concat( query.redirects || [] ).forEach( ( r ) => {
			renamed[ r.from ] = r.to;
		} );
		const found = {};
		( query.pages || [] ).forEach( ( page ) => {
			const info = page.imageinfo && page.imageinfo[ 0 ];
			if ( info ) {
				found[ page.title ] = info.thumburl || info.url;
			}
		} );
		const urls = {};
		titles.forEach( ( title ) => {
			// At most a normalisation followed by a redirect
			let target = title;
			for ( let i = 0; i < 3 && renamed[ target ]; i++ ) {
				target = renamed[ target ];
			}
			urls[ title ] = found[ target ] || null;
			if ( !urls[ title ] ) {
				mw.log.warn( 'GalleryBackgrounds: no image found for ' + title );
			}
		} );
		return urls;
	}

	/**
	 * Look up image URLs at the given width, 50 titles per request, caching the answers.
	 *
	 * @param {string[]} titles
	 * @param {number} width
	 * @return {Promise<Array<string|null>>} URL for each title, in the same order
	 */
	function getImageUrls( titles, width ) {
		const todo = Array.from( new Set( titles ) ).filter( ( t ) => !urlCache.has( width + '|' + t ) );
		for ( let i = 0; i < todo.length; i += 50 ) {
			const batch = todo.slice( i, i + 50 );
			const request = Promise.resolve( api.get( {
				action: 'query',
				prop: 'imageinfo',
				iiprop: 'url',
				iiurlwidth: width,
				titles: batch,
				redirects: true,
				formatversion: 2,
				maxage: 86400,
				smaxage: 86400
			} ) ).then( ( data ) => urlsFromResponse( data, batch ), ( code ) => {
				mw.log.warn( 'GalleryBackgrounds: image lookup failed: ' + code );
				return {};
			} );
			batch.forEach( ( t ) => {
				urlCache.set( width + '|' + t, request.then( ( urls ) => urls[ t ] || null ) );
			} );
		}
		return Promise.all( titles.map( ( t ) => urlCache.get( width + '|' + t ) ) );
	}

	/**
	 * @param {HTMLElement} gallery
	 * @param {string} url Thumbnail-sized background
	 */
	function decorateGallery( gallery, url ) {
		gallery.classList.add( 'gallery-bg' );
		gallery.style.setProperty( '--gallery-bg-image', cssUrl( url ) );
		gallery.querySelectorAll( '.gallerybox > .thumb' ).forEach( ( thumb ) => {
			if ( !thumb.querySelector( ':scope > .gallery-bg-thumb' ) ) {
				const layer = document.createElement( 'span' );
				// mw-no-invert keeps the picture's colours under the DarkMode extension's inverted page
				layer.className = 'gallery-bg-thumb mw-no-invert';
				thumb.insertBefore( layer, thumb.firstChild );
			}
		} );
		// Hook into the viewer before a click on this gallery opens it
		gallery.addEventListener( 'pointerover', patchViewer, { once: true } );
		gallery.addEventListener( 'focusin', patchViewer, { once: true } );
	}

	/**
	 * @param {jQuery} $content
	 */
	function decorateGalleries( $content ) {
		const galleries = [];
		$content.find( 'ul.gallery' ).each( ( i, gallery ) => {
			const title = getBgTitle( gallery );
			if ( title ) {
				galleries.push( { gallery, title } );
				pageTitles.add( title );
			}
		} );
		if ( galleries.length ) {
			getImageUrls( galleries.map( ( g ) => g.title ), THUMB_WIDTH ).then( ( urls ) => {
				galleries.forEach( ( g, i ) => {
					if ( urls[ i ] ) {
						decorateGallery( g.gallery, urls[ i ] );
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
			ui.layer.style.backgroundImage = cssUrl( url );
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
				pageTitles.add( title );
				const titles = Array.from( pageTitles );
				getImageUrls( titles, VIEWER_WIDTH ).then( ( urls ) => {
					if ( viewer.title === title ) {
						viewer.url = urls[ titles.indexOf( title ) ];
						renderViewer();
					}
				} );
			}
		}
		renderViewer();
	}

	/**
	 * Media Viewer only reports an image once it and its details have loaded
	 * (the mmv-metadata event). To switch backgrounds as soon as an image is
	 * opened, also hook the method that opens it.
	 */
	function patchViewer() {
		if ( viewerPatched || !mw.loader.getState( 'mmv' ) || !document.querySelector( '[data-bg]' ) ) {
			return;
		}
		viewerPatched = true;
		mw.loader.using( 'mmv' ).then( ( require ) => {
			const MultimediaViewer = require( 'mmv' ).MultimediaViewer;
			const loadImage = MultimediaViewer && MultimediaViewer.prototype.loadImage;
			if ( typeof loadImage !== 'function' ) {
				return;
			}
			MultimediaViewer.prototype.loadImage = function ( image ) {
				const result = loadImage.apply( this, arguments );
				try {
					showInViewer( image );
				} catch ( e ) {
					mw.log.error( e );
				}
				return result;
			};
		} );
	}

	mw.hook( 'wikipage.content' ).add( decorateGalleries );
	$( document )
		.on( 'mmv-setup-overlay', patchViewer )
		.on( 'mmv-metadata', ( e ) => showInViewer( e.image ) )
		.on( 'mmv-cleanup-overlay', () => showInViewer( null ) );
} );
