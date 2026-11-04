"use strict";
console.error("Deployment blocked: legacy Innera_platform_admin/functions must not be deployed. Use moodsogood_app/functions (Production) or functions_demo (Demo) through the reviewed platform deployment guard.");
process.exitCode = 1;
