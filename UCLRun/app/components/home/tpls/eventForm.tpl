
<div class="eventForm">

  <div class="event-box">
    <div class="event-title">ADD EVENT</div>
    <div class="container-fluid">
      <div class="row">
        <div class="col-md-6">

          <div class="form-group">
            <label for="jobNum">Job Number:</label>
            <input type="text" class="form-control" ng-model="eventForm.data.jobNum">
          </div>
          <div class="form-group">
            <label for="client">Client:</label>
            <input type="text" class="form-control" ng-model="eventForm.data.client">
          </div>

          <div class="form-group">
            <label for="contact">Contact:</label>
            <input type="text" class="form-control" ng-model="eventForm.data.contact">
          </div>

          <div class="form-group">
            <label for="date">Event Date:</label>
            <input type="date" class="form-control" ng-model="eventForm.data.date">
          </div>

          <div class="form-group">
            <label for="time">Event Time:</label>
            <input type="time" class="form-control" ng-model="eventForm.data.time">
          </div>

          
          
          
          
          
        </div>
        <div class="col-md-6">

          <div class="form-group">
            <label for="event">Event:</label>
            <input type="text" class="form-control" ng-model="eventForm.data.event">
          </div>

          <div class="form-group">
            <label for="late">Minutes Late:</label>
            <input type="text" class="form-control" ng-model="eventForm.data.late">
          </div>

          <div class="form-group">
            <label for="eta">ETA:</label>
            <input type="text" class="form-control" ng-model="eventForm.data.eta">
          </div>

          <div class="form-group">
            <label for="type">Job Type:</label>
            <input type="text" class="form-control" ng-model="eventForm.data.type">
          </div>

          
          
      
          
        </div>
        <div class="col-md-12">
            
          <div class="form-group">
            <label for="type">Notes:</label>
            <textarea class="form-control" id="type" ng-model="eventForm.data.notes"></textarea>  
          </div>
        

        <button class="btn btn-primary" ng-click="eventForm.submit()">Add Event</button>
        <button class="btn btn-default" ng-click="eventForm.cancel()">Cancel</button>

        </div>
      </div>
    </div>
  </div>
</div>

