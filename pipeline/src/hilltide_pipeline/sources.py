"""The open datasets Hilltide is built from: license and required credit.

These entries are copied into the manifest, and the site's credits section
is generated from them. Each license was read from the publisher's own
license page; docs/LICENSES.md records where and when.
"""

from __future__ import annotations

SOURCES: dict[str, dict] = {
    "copernicus-dem": {
        "name": "Copernicus DEM GLO-30 and GLO-90",
        "publisher": "European Space Agency, Airbus",
        "license": "Copernicus DEM licence (free use, credit required)",
        "licenseUrl": "https://docs.sentinel-hub.com/api/latest/static/files/data/dem/resources/license/License-COPDEM-30.pdf",
        "url": "https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM",
        "attribution": (
            "Produced using Copernicus WorldDEM-30 (c) DLR e.V. 2010-2014 and (c) Airbus "
            "Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European "
            "Union and ESA; all rights reserved."
        ),
    },
}
