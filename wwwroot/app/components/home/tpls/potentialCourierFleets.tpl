<div ng-if="courierFleets">

<div class="table-headings">
    <table>
        <thead class="thead-dark no select">
        <tr>
        <th scope="col" ng-click="orderList('potentialCourierFleets', 'Fleet')">Fleet Name<i class="fa fa-caret-down" ng-show="sort.potentialCouriers =='courier'"></i><i class="fa fa-caret-up" ng-show="sort.potentialCouriers =='d-courier'"></i></th>
        </tr>
        </thead>
    </table>


</div>

<table class="table table-striped table-responsive table-rows" id="potentialCourierFleets" data-group="couriers">
    <tbody>
	<!-- draggable-row droppable-row -->
    <tr class="clickable-row noselect " data-isCourier="1" ng-repeat="fleet in fleetGroups | filter: box.searchBox" ng-mouseup="showCouriers(fleet)" data-courier="{{fleet.name}}">
        <td>{{fleet.name}}</td>
    </tr>
    </tbody>
</table>

</div>


<div class="loading">
    <div class="text">
        <i class="fas fa-spinner fa-spin fa-spin fa-3x fa-fw"></i>
        <span class="sr-only">Loading...</span>
    </div>
</div>

<script>

    $(".box-content").on("scroll", function() {
        var newTop = $(this).scrollTop();
        $(this).find(".table-headings").css({"top":newTop});
    });





</script>