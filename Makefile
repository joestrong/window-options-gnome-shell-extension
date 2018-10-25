#=============================================================================
UUID=window-options@mathematical.coffee.gmail.com
# Do I want po folder in here?
FILES=metadata.json *.js stylesheet.css schemas locale po
#=============================================================================
default_target: all
.PHONY: clean all zip

clean:
	rm -f $(UUID).zip $(UUID)/schemas/gschemas.compiled
	rm -rf $(UUID)/locale

# nothing in this target, just make the zip
all: clean
	@if [ -d $(UUID)/schemas ]; then \
		echo "glib-compile-schemas $(UUID)/schemas"; \
		glib-compile-schemas $(UUID)/schemas; \
	fi
	@if [ -d $(UUID)/po ]; then \
		(cd $(UUID)/po && ./make_translations); \
		echo "(cd $(UUID)/po && ./make_translations)"; \
	fi

zip: all
	zip -rq $(UUID).zip $(FILES:%=$(UUID)/%)

dev-zip: all
	(cd $(UUID); \
		zip -rq ../$(UUID).zip $(FILES))
