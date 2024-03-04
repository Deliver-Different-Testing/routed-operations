<div ng-if="potentialCouriers.length > 0">

<div class="table-headings">
    <table>
        <thead class="thead-dark no select">
        <tr>
        <th scope="col" ng-click="orderList('potentialCouriers', 'courier')">Courier <i class="fa fa-caret-down" ng-show="sort.potentialCouriers =='courier'"></i><i class="fa fa-caret-up" ng-show="sort.potentialCouriers =='d-courier'"></i></th>
        </tr>
        </thead>
    </table>


</div>

<table class="table table-striped table-responsive table-rows" id="potentialCouriers" data-group="couriers">
    <tbody>
    <tr class="clickable-row noselect draggable-row droppable-row" data-isCourier="1" ng-repeat="courier in potentialCouriers | filter: box.searchBox" ng-click="selectCourier(courier)" data-courier="{{courier.courier}}">
        <td>{{courier.courier}}</td>
    </tr>
    </tbody>
</table>

</div>

<div class="no-data" ng-if="potentialCouriers < 1">
    <div class="text">Please select a group with courier fleet</div>
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