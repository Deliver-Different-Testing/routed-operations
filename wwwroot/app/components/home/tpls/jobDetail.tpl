<div class="container-fluid" id="jobDetail" style="padding:0" ng-if="currentJob">
	<div class="fields">
		<div class="row row-no-padding row-out">
			<div class="col-md-6">
				<div class="row row-no-padding addresses">
					<div class="col-md-6">
						<div class="field">
							<label>Client</label>
							<div class="value"><a class="uline" src="#" ng-click="">{{currentJob.ClientCode}}</a></div>
						</div>
						<div class="field contact" ng-class="currentJob.fromLng ? '' : 'red'" context-menu="detailAddressMenu" data-field="FromAddress" ng-click="editDetailField('FromAddress','From Address',currentJob.FromAddress,currentJob.BulkJobID,'textarea')">
							<label>From: {{currentJob.FromCompany}}</label>
							<div class="value">{{currentJob.FromAddress}}</div>
						</div>
					</div>
					<div class="col-md-6">
						<div class="field">
							<label>Contact</label>
							<div class="value">{{currentJob.Contact}}</div>
						</div>
						<div class="field contact" ng-class="currentJob.toLng ? '' : 'red'" context-menu="detailAddressMenu" data-field="ToAddress" ng-click="editDetailField('ToAddress','To Address',currentJob.ToAddress,currentJob.BulkJobID,'textarea')">
							<label>To: {{currentJob.ToCompany}}</label>
							<div class="value">{{currentJob.ToAddress}}</div>
						</div>
					</div>
				</div>
				<div class="notes-add"></div>
				<div class="notes field" ng-click="editDetailField('Notes','Notes',currentJob.Notes,currentJob.BulkJobID,'textarea')">
					<label>Notes</label>
					<div class="value"><pre>{{currentJob.Notes}}</pre></div>
				</div>

			</div>
			<div class="col-md-6">
				<div class="row row-no-padding">
					<div class="col-md-4">

						<div class="field" ng-click="editDetailField('ProofOfDeliveryMobile','Phone Number',currentJob.Mobile,currentJob.BulkJobID)">
							<label>Phone</label>
							<div class="value">{{currentJob.Mobile}}</div>
						</div>
						<div class="field" ng-click="editDetailField('Size','Size',currentJob.Size,currentJob.BulkJobID, 'select', options.detail.size)">
							<label>Size</label>
							<div class="value">{{currentJob.Size}}</div>
						</div>
						<div class="field" ng-click="editDetailField('Qty','Items',currentJob.Items,currentJob.BulkJobID)">
							<label>Items</label>
							<div class="value">{{currentJob.Items}}</div>
						</div>
						<div class="field" ng-click="editDetailField('Weight','Weight',currentJob.Weight,currentJob.BulkJobID)">
							<label>Weight</label>
							<div class="value">{{currentJob.Weight}}</div>
						</div>
						<div class="field" ng-click="editDetailField('ClientRefa','Ref A',currentJob.ClientRefa,currentJob.BulkJobID)">
							<label>Ref A</label>
							<div class="value">{{currentJob.ClientRefa}}</div>
						</div>
						<div class="field" ng-click="editDetailField('ClientRefb','Ref B',currentJob.ClientRefb,currentJob.BulkJobID)">
							<label>Ref B</label>
							<div class="value">{{currentJob.ClientRefb}}</div>
						</div>
						<div class="field" ng-click="editDetailField('OurRef','Our Ref',currentJob.OurRef,currentJob.BulkJobID)">
							<label>Our Ref</label>
							<div class="value">{{currentJob.OurRef}}</div>
						</div>
						<!--
						<div class="field" ng-click="editDetailField('Event','Event',currentJob.Event,currentJob.BulkJobID)">
							<label>Event</label>
							<div class="value">{{currentJob.Event}}</div>
						</div> -->
					</div>
					<div class="col-md-4">
					<!--
						<div class="field" ng-click="editDetailField('PodName','POD Name',currentJob.PodName,currentJob.BulkJobID)">
							<label>POD Name</label>
							<div class="value">{{currentJob.PodName}}</div>
						</div>
						<div class="field" ng-click="editDetailField('SpeedAccepted','Speed Accepted',currentJob.SpeedAccepted,currentJob.BulkJobID)">
							<label>Speed Accepted</label>
							<div class="value">{{currentJob.SpeedAccepted}}</div>
						</div>
						<div class="field" ng-click="editDetailField('SpeedNofitied','Speed Nofitied',currentJob.SpeedNofitied,currentJob.BulkJobID)">
							<label>Speed Notified</label>
							<div class="value">{{currentJob.SpeedNofitied}}</div>
						</div>
						<div class="field" ng-click="editDetailField('Direct','Direct',currentJob.Direct,currentJob.BulkJobID)">
							<label>Direct</label>
							<div class="value">{{currentJob.Direct}}</div>
						</div>
						-->
						<div class="field" ng-click="editDetailField('SigNotRequired','Signature Not Required',currentJob.Ok_To_Leave,currentJob.BulkJobID)">
							<label>Sig not req</label>
							<div class="value">{{currentJob.Ok_To_Leave}}</div>
						</div>
						<!--
						<div class="field" ng-click="editDetailField('UDStatus','UD Status',currentJob.UDStatus,currentJob.BulkJobID)">
							<label>UD status</label>
							<div class="value">{{currentJob.UDStatus}}</div>
						</div>
						<div class="field" ng-click="editDetailField('DGClass','DG Class',currentJob.DGClass,currentJob.BulkJobID)">
							<label>DG #         Docs</label>
							<div class="value">{{currentJob.DGClass}}</div>
						</div>
						-->
						<div class="field" ng-click="editDetailField('CourierID','Courier',currentJob.Courier,currentJob.BulkJobID)">
							<label>Courier</label>
							<div class="value">{{currentJob.Courier}}</div>
						</div>
						<div class="field" ng-click="editDetailField('Speed','Speed','' + currentJob.SpeedID,currentJob.BulkJobID, 'select', getSpeedOptions())">
							<label>Speed</label>
							<div class="value">{{getSpeedLabel(currentJob.SpeedID)}}</div>
						</div>
					</div>
					<div class="col-md-4">
					<!--
						<div class="field" ng-click="editDetailField('PodTime','POD Time',currentJob.PodTime,currentJob.BulkJobID,'time')">
							<label>POD Time</label>
							<div class="value">{{currentJob.PodTime | date : "h:mm a"}}</div>
						</div>
						-->
						<div class="field" ng-click="editDetailField('JobNumber','Job Number',currentJob.JobNumber,currentJob.BulkJobID)">
							<label>Job #</label>
							<div class="value">{{currentJob.JobNumber}}</div>
						</div>
						<div class="field" ng-click="editDetailField('BookDate','Date',currentJob.DeliveryDate,currentJob.BulkJobID, 'date')">
							<label>Date</label>
							<div class="value">{{formatDateForDisplay(currentJob.DeliveryDate)}}</div>
						</div>
						<div class="field" ng-click="editDetailField('BookTime','Time',currentJob.ReadyTime,currentJob.BulkJobID,'time')">
							<label>Log time</label>
							<div class="value">{{formatTimeForDisplay(currentJob.ReadyTime)}}</div>
						</div>
						<!--
						<div class="field" ng-click="editDetailField('DispatchTime','Dispatch Time',currentJob.DispatchTime,currentJob.BulkJobID,'time')">
							<label>Dispatch time</label>
							<div class="value">{{currentJob.DispatchTime | date : "h:mm a"}}</div>
						</div>
						<div class="field" ng-click="editDetailField('PU','PU',currentJob.PU,currentJob.BulkJobID)">
							<label>PU time</label>
							<div class="value">{{currentJob.PU}}</div>
						</div>
						-->
						<div class="field" ng-click="editDetailField('Amount','Charge',currentJob.Amount,currentJob.BulkJobID)">
							<label>Charge</label>
							<div class="value">{{currentJob.Amount | currency: "$ "}}</div>
						</div>
						<!--
						<div class="field" ng-click="editDetailField('ClientNotes','Client Notes',currentJob.ClientNotes,currentJob.BulkJobID, 'textarea')">
							<label>Client notes</label>
							<div class="value">{{currentJob.ClientNotes}}</div>
						</div>
						-->
					</div>
				</div>
			</div>

		</div>

	</div>
</div>

<div ng-if="currentCourier" style="height: 100%;">
	<div class="overlay-map-fix"></div>
	<iframe src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d18042.219705093252!2d174.80882121707236!3d-36.92755660674388!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x88d0fdf8f51b1d11!2sUrgent+Couriers!5e0!3m2!1sen!2snz!4v1523407620949" width="100%" height="100%" frameborder="0" style="border:0" allowfullscreen></iframe>

</div>

<div class="no-data" ng-if="!currentJob && !currentCourier">
    <div class="text">Please select a job</div>
</div>


<div class="loading">
    <div class="text">
        <i class="fas fa-spinner fa-spin fa-spin fa-3x fa-fw"></i>
        <span class="sr-only">Loading...</span>
    </div>
</div>
