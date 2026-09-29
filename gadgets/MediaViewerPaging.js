/**
 * Media Viewer paging
 *
 * Smoother paging through images in Media Viewer:
 *
 * - An image that has already been loaded is shown straight away. Media Viewer hands it
 *   over through an asynchronous promise, so it otherwise shows a placeholder for a frame.
 * - While an image is still loading, its placeholder is shown at full size, as Media Viewer
 *   intends. When paging, a bug leaves it at the page thumbnail's small size, so the image
 *   seems to shrink and grow again (see also MediaViewerPaging.css).
 * - The previous image is preloaded along with the next one, which Media Viewer already does.
 */
( function () {
	'use strict';

	let patched = false;

	/**
	 * Show the image now if Media Viewer has it loaded already.
	 *
	 * @param {Object} viewer MultimediaViewer
	 * @param {Object} image LightboxImage being opened
	 * @return {boolean} Whether the image was shown
	 */
	function showLoadedImage( viewer, image ) {
		const widths = viewer.ui.canvas.getCurrentImageWidths();
		const ext = image.filePageTitle.getExtension().toLowerCase();
		let width = widths.real;
		// Same clamping as MultimediaViewer#fetchThumbnail, so these lookups hit its caches
		if ( ext !== 'svg' && image.originalWidth && width > image.originalWidth ) {
			width = image.originalWidth;
		}
		let shown = false;
		const thumbnailPromise = viewer.thumbnailInfoProvider.get( image.filePageTitle, image.src, width );
		if ( thumbnailPromise.state() === 'resolved' ) {
			// done() on a resolved jQuery promise runs synchronously
			thumbnailPromise.done( ( thumbnail ) => {
				const imagePromise = viewer.imageProvider.get( thumbnail.url );
				if ( imagePromise.state() === 'resolved' ) {
					imagePromise.done( ( element ) => {
						// As MultimediaViewer#loadImage does once the image arrives; it then finds it already in place
						element.className = 'mw-mmv-final-image ' + ext;
						element.alt = image.alt;
						viewer.realThumbnailShown = true;
						viewer.setImage( thumbnail, element, widths );
						shown = true;
					} );
				}
			} );
		}
		return shown;
	}

	/**
	 * Size the placeholder. Media Viewer skips this when paging, because it checks whether the
	 * previous image was shown before resetting that flag for the new one.
	 *
	 * @param {Object} viewer MultimediaViewer
	 * @param {Object} image LightboxImage being opened
	 */
	function sizePlaceholder( viewer, image ) {
		const $placeholder = viewer.ui.canvas.$image;
		if ( $placeholder && $placeholder.hasClass( 'mw-mmv-placeholder-image' ) && !$placeholder[ 0 ].style.width ) {
			viewer.displayPlaceholderThumbnail( image, $placeholder, viewer.ui.canvas.getCurrentImageWidths() );
		}
	}

	/**
	 * Load the images either side of the one being shown, wrapping around like the viewer does.
	 *
	 * @param {Object} viewer MultimediaViewer
	 * @param {Object} image LightboxImage being shown
	 */
	function preloadNeighbours( viewer, image ) {
		const thumbs = viewer && viewer.isOpen && viewer.thumbs;
		// Media Viewer also reports images whose details arrive after another was opened
		if ( !thumbs || thumbs.length < 2 || viewer.currentImage !== image || typeof viewer.fetchThumbnail !== 'function' ) {
			return;
		}
		[ -1, 1 ].forEach( ( step ) => {
			const neighbour = thumbs[ ( image.index + step + thumbs.length ) % thumbs.length ];
			viewer.fetchThumbnail( neighbour, viewer.ui.canvas.getLightboxImageWidths( neighbour ).real );
			viewer.fetchSizeIndependentLightboxInfo( neighbour.filePageTitle );
		} );
	}

	/**
	 * Hook the method that opens an image. Done when the viewer first opens: that image
	 * isn't affected (the bugs only show once an image has been displayed), later ones are.
	 */
	function patchViewer() {
		// The classic viewer is loaded by now; if it isn't (mobile beta viewer), leave things be
		if ( patched || mw.loader.getState( 'mmv' ) !== 'ready' ) {
			return;
		}
		patched = true;
		mw.loader.using( 'mmv' ).then( ( require ) => {
			const MultimediaViewer = require( 'mmv' ).MultimediaViewer;
			const loadImage = MultimediaViewer && MultimediaViewer.prototype.loadImage;
			if ( typeof loadImage !== 'function' ) {
				return;
			}
			MultimediaViewer.prototype.loadImage = function ( image ) {
				const result = loadImage.apply( this, arguments );
				try {
					if ( !showLoadedImage( this, image ) ) {
						sizePlaceholder( this, image );
					}
				} catch ( e ) {
					mw.log.error( e );
				}
				return result;
			};
		} );
	}

	$( document )
		.on( 'mmv-setup-overlay', patchViewer )
		// Fired once the current image and its details have loaded
		.on( 'mmv-metadata', ( e ) => {
			try {
				preloadNeighbours( e.viewer, e.image );
			} catch ( err ) {
				mw.log.error( err );
			}
		} );
}() );
