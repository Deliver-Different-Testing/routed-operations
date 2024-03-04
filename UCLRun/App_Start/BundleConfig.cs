using System.Web;
using System.Web.Optimization;

namespace UCLRun
{
    public class BundleConfig
    {
        // For more information on bundling, visit https://go.microsoft.com/fwlink/?LinkId=301862
        public static void RegisterBundles(BundleCollection bundles)
        {
            // Script
            bundles.Add(new ScriptBundle("~/bundles/scripts")
                .Include("~/Scripts/jquery-{version}.js")
                .Include("~/Scripts/jquery-ui.min.js")
                .Include("~/Scripts/jquery.timepicker.min.js")
                .Include("~/Scripts/date.min.js")
                //.Include("~/Scripts/bootstrap.min.js")
                .Include("~/Scripts/libs/angular/angular.min.js")
                .Include("~/Scripts/libs/ui-select/select.js")
                .Include("~/Scripts/libs/ui-router/angular-ui-router.min.js")
                .Include("~/Scripts/libs/ui-router/ct-ui-router-extras.min.js")
                .Include("~/Scripts/libs/resizable/angular-resizable.min.js")
                .Include("~/Scripts/libs/sortable.js")
                .Include("~/Scripts/libs/contextMenu.js")
                .Include("~/Scripts/libs/hotkeys/hotkeys.min.js")
                .Include("~/Scripts/libs/timepickerdirective.min.js")
                .Include("~/Scripts/libs/autocomplete/angular-auto-complete.js")
                .Include("~/Scripts/libs/ng-map-autocomplete.js")
                .Include("~/Scripts/libs/ng-map.min.js")
                .Include("~/Scripts/libs/angularjs-dropdown-multiselect.min.js")
                .Include("~/Scripts/libs/pickdate/angular-pickadate.js")
                .Include("~/Scripts/libs/moment/moment.js")
                .Include("~/Scripts/libs/heremap/*.js")
            );

            //bundles.Add(new ScriptBundle("~/bundles/jqueryval").Include(
            //            "~/Scripts/jquery.validate*"));

            //// Use the development version of Modernizr to develop with and learn from. Then, when you're
            //// ready for production, use the build tool at https://modernizr.com to pick only the tests you need.
            //bundles.Add(new ScriptBundle("~/bundles/modernizr").Include(
            //            "~/Scripts/modernizr-*"));

            //bundles.Add(new ScriptBundle("~/bundles/bootstrap").Include(
            //          "~/Scripts/bootstrap.js"));


            // CSS
            bundles.Add(new StyleBundle("~/Content/jquerybootstrapcss")
                .Include(
                            "~/Content/assets/css/jquery.timepicker.min.css"
                          //  "~/Content/assets/css/bootstrap.min.css"
                ));

            bundles.Add(new StyleBundle("~/Content/css")
                .Include(
                    "~/Scripts/libs/resizable/angular-resizable.min.css",
                    "~/Scripts/libs/hotkeys/hotkeys.min.css",
                    "~/Scripts/libs/autocomplete/angular-auto-complete.css",
                    "~/Scripts/libs/pickdate/angular-pickadate.css",
                    "~/Scripts/libs/ui-select/select.css",
                    "~/Scripts/libs/heremap/*.css"
                    ));

            //enables bundling and minification in debug mode
            //BundleTable.EnableOptimizations = true;
        }
    }
}
