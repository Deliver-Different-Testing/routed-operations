using Microsoft.VisualStudio.TestTools.UnitTesting;
using UCLRun.Models.Repository;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using UCLRun.Models.Interface;
using UCLRun.Models.Repository;

namespace UCLRun.Tests
{
    [TestClass()]
    public class JobTests
    {
        private IJobRepository _Repo = new JobRepository();


        [TestMethod()]
        public void InsertOrUpdateRunTest()
        {
            DespatchContext context = new DespatchContext();
            var runResult = context.InsertOrUpdateRun(null , "TestRunName", 70, 46, null,
                null, null, null, null, "'{googlerouteresponsedata}'").FirstOrDefault();

            if (runResult == null)
            {
                Assert.Fail();
            }
           
        }

        //[TestMethod()]
        //public void GetBulkRunTest()
        //{
        //    DespatchContext context = new DespatchContext();
        //    var runResult = context.GetBulkRun().ToList();

        //    if (runResult == null)
        //    {
        //        Assert.Fail();
        //    }

        //    Assert.IsTrue(runResult.Count > 0);
           
        //}

            
    }
}