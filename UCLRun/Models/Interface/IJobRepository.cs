using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace UCLRun.Models.Interface
{
    public interface IJobRepository
    {
        List<BulkJob> GetBulkJobs(DateTime? dateTime, string clietnIds);

        tblBulkJob GetBulkJobByID(int jobID);

        //void InsertBulkJob(vw_tblBulkJob bulkJob);

        bool Update(tblBulkJob bulkJob, string proerptyName, string value);
        bool UpdateBulkJob(tblBulkJob bulkJob);
        //void UpdateBulkJob(vw_tblBulkJob bulkJob);

        //void DeleteBulkJob(int id);
    
        List<Response> InsertJobs(IEnumerable<RunJob> runJobs);

        Object GetBulkRunSettings();

        List<BulkRun> GetBulkRuns(DateTime? dateTime, string clientIds);
        Response InsertOrUpdateRun(RunJob run);
        void DeleteBulkRun(int ID);
    }
}
